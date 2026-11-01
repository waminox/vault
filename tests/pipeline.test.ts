import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end through the real modules: resumable upload → sniff → encrypt →
 * thumbnails / transcode / storyboard → decrypting range reads → reorder.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-pipeline-"));
process.env.VAULT_DATA_DIR = dataDir;
process.env.VAULT_KDF_LOGN = "10";
process.env.VAULT_CHUNK_MB = "1";

type M = typeof import("@/lib/server/media");
let media: M;
let uploads: typeof import("@/lib/server/uploads");
let keyring: typeof import("@/lib/server/keyring");
let storage: typeof import("@/lib/server/storage");

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function streamOf(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(buf));
      c.close();
    },
  });
}

async function upload(data: Buffer, name: string, albumId: string | null = null, order?: number[]) {
  const s = await uploads.createUpload({ name, size: data.length, albumId, lastModified: Date.now() });
  const indexes = order ?? [...Array(s.totalChunks).keys()].reverse(); // out of order on purpose
  for (const i of indexes) {
    await uploads.writeChunk(s.id, i, streamOf(data.subarray(i * s.chunkSize, (i + 1) * s.chunkSize)));
  }
  return uploads.completeUpload(s.id);
}

async function waitReady(id: string, timeout = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const row = media.getItem(id);
    if (!row) return undefined;
    if (row.status !== "processing") return row;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${id}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitJobsIdle(timeout = 120_000) {
  const { db } = await import("@/lib/server/db");
  const t0 = Date.now();
  while ((db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('pending','running')").get() as { n: number }).n > 0) {
    if (Date.now() - t0 > timeout) throw new Error("jobs did not finish");
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  keyring = await import("@/lib/server/keyring");
  media = await import("@/lib/server/media");
  uploads = await import("@/lib/server/uploads");
  storage = await import("@/lib/server/storage");
  const { onUnsealed } = await import("@/lib/server/events");
  const { kick } = await import("@/lib/server/processing");
  onUnsealed(kick);
  await keyring.initVault("a long test passphrase");
  expect(await keyring.unlock("wrong passphrase!!")).toBe("bad-passphrase");
  expect(await keyring.unlock("a long test passphrase")).toBe("ok");
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("upload pipeline", () => {
  it("ingests a photo: encrypted at rest, thumbnails, EXIF-free derivatives", async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#3366ff" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret-marker" } } })
      .jpeg()
      .toBuffer();
    const album = media.createAlbum("Holidays");
    const dto = await upload(jpeg, "../../beach.jpg", album.id);
    expect(dto.name).toBe("beach.jpg");
    expect(dto.status).toBe("processing");

    const row = (await waitReady(dto.id))!;
    expect(row.status).toBe("ready");
    expect(row.width).toBe(3000);
    expect(row.height).toBe(2000);
    const v = media.parseVariants(row);
    expect(v.original && v.thumb && v.preview).toBeTruthy();

    // Bytes on disk are ciphertext.
    const onDisk = fs.readFileSync(storage.blobPath(v.original!.blob));
    expect(onDisk.subarray(0, 4).toString()).toBe("VLT1");
    expect(onDisk.includes(Buffer.from("secret-marker"))).toBe(false);

    // Original decrypts byte-for-byte; derivatives are stripped of EXIF.
    expect((await storage.readBlob(v.original!.blob)).equals(jpeg)).toBe(true);
    const preview = await storage.readBlob(v.preview!.blob);
    expect(preview.includes(Buffer.from("secret-marker"))).toBe(false);
    const meta = await sharp(preview).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);

    // No plaintext left behind.
    expect(fs.readdirSync(path.join(dataDir, "work")).filter((f) => f.startsWith("ingest-"))).toEqual([]);
  });

  it("refuses non-media disguised with an image name", async () => {
    const php = Buffer.from("<?php eval($_POST['x']); ?>".padEnd(2048, " "));
    await expect(upload(php, "image_sC6trZ_291.jpg")).rejects.toMatchObject({ status: 415 });
  });

  it("detects corrupted chunks and incomplete uploads", async () => {
    const data = Buffer.alloc(2.5 * 1024 * 1024, 7);
    const s = await uploads.createUpload({ name: "x.jpg", size: data.length, albumId: null });
    await expect(uploads.writeChunk(s.id, 0, streamOf(data.subarray(0, 1024 * 1024)), "0".repeat(64))).rejects.toMatchObject({ status: 422 });
    await expect(uploads.writeChunk(s.id, 0, streamOf(data.subarray(0, 100)))).rejects.toMatchObject({ status: 400 });
    await expect(uploads.completeUpload(s.id)).rejects.toMatchObject({ status: 409 });
    await uploads.writeChunk(s.id, 1, streamOf(data.subarray(1024 * 1024, 2 * 1024 * 1024)));
    expect(uploads.status(s.id).received).toEqual([1]);
    // Resuming the same file returns the same session with progress intact.
    const again = await uploads.createUpload({ name: "x.jpg", size: data.length, albumId: null, resumeId: s.id });
    expect(again.id).toBe(s.id);
    expect(again.received).toEqual([1]);
    await uploads.abortUpload(s.id);
  });

  it("skips exact duplicates", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const a = await upload(png, "red.png");
    await waitReady(a.id);
    const b = await upload(png, "red copy.png");
    expect(await waitReady(b.id)).toBeUndefined(); // removed as duplicate
    expect(media.getItem(a.id)?.status).toBe("ready");
  });

  it("reorders with fractional positions and moves between albums", async () => {
    const album = media.createAlbum("Order");
    const ids: string[] = [];
    for (const color of ["#100000", "#200000", "#300000", "#400000"]) {
      const img = await sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer();
      ids.push((await upload(img, `${color}.png`, album.id)).id);
    }
    await Promise.all(ids.map((id) => waitReady(id)));
    const order = () => media.listItems({ view: "album", albumId: album.id, sort: "manual", dir: "asc", offset: 0, limit: 100 }).items.map((i) => i.id);
    expect(order()).toEqual(ids);

    media.moveItems([ids[3]], album.id, null); // to the front
    expect(order()).toEqual([ids[3], ids[0], ids[1], ids[2]]);
    media.moveItems([ids[0], ids[1]], album.id, ids[2]); // block to the end
    expect(order()).toEqual([ids[3], ids[2], ids[0], ids[1]]);

    const other = media.createAlbum("Other");
    media.moveToAlbum([ids[2]], other.id);
    expect(order()).toEqual([ids[3], ids[0], ids[1]]);
    media.trashItems([ids[3]]);
    expect(order()).toEqual([ids[0], ids[1]]);
    media.restoreItems([ids[3]]);
    expect(order()).toEqual([ids[0], ids[1], ids[3]]);
  });

  it.skipIf(!hasFfmpeg)(
    "converts an unplayable video and builds a scrub storyboard",
    async () => {
      const src = path.join(dataDir, "clip.avi");
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=9", "-c:v", "mpeg4", src]);
      const data = fs.readFileSync(src);
      const dto = await upload(data, "clip.avi");
      expect(dto.kind).toBe("video");
      expect(dto.mime).toBe("video/x-msvideo");
      await waitJobsIdle();
      const row = media.getItem(dto.id)!;
      expect(row.status).toBe("ready");
      expect(row.duration).toBeGreaterThan(8);
      const v = media.parseVariants(row);
      expect(v.playback?.mime).toBe("video/mp4");
      expect(v.poster && v.thumb && v.storyboard).toBeTruthy();

      // Random-access read of the encrypted MP4 starts with an ftyp box (faststart).
      const r = await storage.openBlobReader(v.playback!.blob);
      const parts: Buffer[] = [];
      for await (const p of r.read(0, 11)) parts.push(p);
      await r.close();
      expect(Buffer.concat(parts).subarray(4, 8).toString()).toBe("ftyp");
    },
    180_000,
  );

  it("seals: the key is wiped and jobs cannot read blobs", async () => {
    keyring.seal();
    expect(keyring.isUnsealed()).toBe(false);
    const row = media.listItems({ view: "all", sort: "added", dir: "desc", offset: 0, limit: 1 }).items[0];
    const v = media.parseVariants(media.getItem(row.id)!);
    await expect(storage.readBlob(v.original!.blob)).rejects.toThrow(/sealed/);
  });
});
