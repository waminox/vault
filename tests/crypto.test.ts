import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  blobKey,
  createEncryptStream,
  decryptToBuffer,
  deriveKek,
  encryptBuffer,
  newKdfParams,
  openBlob,
  openBytes,
  plaintextLength,
  sealBytes,
} from "@/lib/server/crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-crypto-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const key = crypto.randomBytes(32);
const CHUNK = 64 * 1024;

async function encryptViaStream(data: Buffer, file: string, pieces = 7): Promise<void> {
  // Feed odd-sized pieces to exercise the buffering logic.
  const parts: Buffer[] = [];
  const step = Math.max(1, Math.ceil(data.length / pieces));
  for (let i = 0; i < data.length; i += step) parts.push(data.subarray(i, i + step));
  await pipeline(Readable.from(parts), createEncryptStream(key), fs.createWriteStream(file));
}

describe("chunked AEAD blobs", () => {
  const sizes = [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 12345];

  for (const size of sizes) {
    it(`round-trips ${size} bytes (stream and buffer encoders agree on format)`, async () => {
      const data = crypto.randomBytes(size);
      const a = path.join(tmp, `a-${size}`);
      const b = path.join(tmp, `b-${size}`);
      await encryptViaStream(data, a);
      fs.writeFileSync(b, encryptBuffer(key, data));
      expect(fs.statSync(a).size).toBe(fs.statSync(b).size);
      expect(plaintextLength(fs.statSync(a).size)).toBe(size);
      expect((await decryptToBuffer(a, key)).equals(data)).toBe(true);
      expect((await decryptToBuffer(b, key)).equals(data)).toBe(true);
    });
  }

  it("serves arbitrary byte ranges without decrypting the whole file", async () => {
    const data = crypto.randomBytes(5 * CHUNK + 999);
    const f = path.join(tmp, "range");
    fs.writeFileSync(f, encryptBuffer(key, data));
    const r = await openBlob(f, key);
    const ranges: [number, number][] = [
      [0, 0],
      [0, 99],
      [CHUNK - 5, CHUNK + 5],
      [2 * CHUNK, 2 * CHUNK],
      [123, 4 * CHUNK + 77],
      [data.length - 1, data.length - 1],
      [0, data.length - 1],
    ];
    for (const [s, e] of ranges) {
      const parts: Buffer[] = [];
      for await (const p of r.read(s, e)) parts.push(p);
      expect(Buffer.concat(parts).equals(data.subarray(s, e + 1))).toBe(true);
    }
    await r.close();
  });

  it("rejects a tampered byte", async () => {
    const f = path.join(tmp, "tamper");
    const enc = encryptBuffer(key, crypto.randomBytes(3 * CHUNK));
    enc[16 + CHUNK + 100] ^= 1; // inside chunk 1
    fs.writeFileSync(f, enc);
    await expect(decryptToBuffer(f, key)).rejects.toThrow(/integrity/);
  });

  it("rejects truncation at a chunk boundary", async () => {
    const f = path.join(tmp, "trunc");
    const enc = encryptBuffer(key, crypto.randomBytes(3 * CHUNK + 10));
    fs.writeFileSync(f, enc.subarray(0, 16 + 2 * (CHUNK + 16))); // drop the last chunks cleanly
    await expect(openBlob(f, key)).rejects.toThrow(/integrity/);
  });

  it("rejects swapped chunks", async () => {
    const f = path.join(tmp, "swap");
    const enc = encryptBuffer(key, crypto.randomBytes(3 * CHUNK + 10));
    const stride = CHUNK + 16;
    const c0 = Buffer.from(enc.subarray(16, 16 + stride));
    enc.subarray(16 + stride, 16 + 2 * stride).copy(enc, 16);
    c0.copy(enc, 16 + stride);
    fs.writeFileSync(f, enc);
    await expect(decryptToBuffer(f, key)).rejects.toThrow(/integrity/);
  });

  it("rejects the wrong key", async () => {
    const f = path.join(tmp, "wrongkey");
    fs.writeFileSync(f, encryptBuffer(key, Buffer.from("hello")));
    await expect(decryptToBuffer(f, crypto.randomBytes(32))).rejects.toThrow();
  });

  it("derives distinct per-blob keys", () => {
    expect(blobKey(key, "a".repeat(32)).equals(blobKey(key, "b".repeat(32)))).toBe(false);
  });
});

describe("key wrapping", () => {
  it("wraps and unwraps; wrong passphrase fails", async () => {
    const params = newKdfParams(10);
    const kek = await deriveKek("correct horse battery staple", params);
    const mk = crypto.randomBytes(32);
    const wrapped = sealBytes(mk, kek);
    expect(openBytes(wrapped, kek)?.equals(mk)).toBe(true);
    const bad = await deriveKek("correct horse battery stapler", params);
    expect(openBytes(wrapped, bad)).toBeNull();
  });

  it("normalizes unicode passphrases", async () => {
    const params = newKdfParams(10);
    const a = await deriveKek("café-secret", params);
    const b = await deriveKek("café-secret", params);
    expect(a.equals(b)).toBe(true);
  });
});
