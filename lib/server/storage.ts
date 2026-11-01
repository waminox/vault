import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config";
import { blobKey, createEncryptStream, decryptToBuffer, decryptToFile, encryptBuffer, openBlob, type BlobReader } from "./crypto";
import { masterKey } from "./keyring";

/**
 * Content-addressed by random id, never by name: nothing on disk reveals what a
 * file is, and nothing in the blob store is ever executable or web-served.
 */

const ID_RE = /^[a-f0-9]{32}$/;

export function newBlobId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function blobPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error("Invalid blob id");
  return path.join(config.blobDir, id.slice(0, 2), id);
}

async function prepare(id: string): Promise<{ final: string; tmp: string }> {
  const final = blobPath(id);
  await fsp.mkdir(path.dirname(final), { recursive: true, mode: 0o700 });
  return { final, tmp: `${final}.${process.pid}.tmp` };
}

export interface WrittenBlob {
  id: string;
  size: number;
  sha256: string;
}

/** Encrypt a plaintext file into a new blob. Also returns the plaintext SHA-256. */
export async function writeBlobFromFile(src: string): Promise<WrittenBlob> {
  return writeBlobFromStream(fs.createReadStream(src, { highWaterMark: 1 << 20 }));
}

export async function writeBlobFromStream(src: Readable): Promise<WrittenBlob> {
  const id = newBlobId();
  const { final, tmp } = await prepare(id);
  const hash = crypto.createHash("sha256");
  let size = 0;
  const tap = new Transform({
    transform(d: Buffer, _e, cb) {
      hash.update(d);
      size += d.length;
      cb(null, d);
    },
  });
  try {
    await pipeline(src, tap, createEncryptStream(blobKey(masterKey(), id)), fs.createWriteStream(tmp, { mode: 0o600 }));
    await fsp.rename(tmp, final);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  return { id, size, sha256: hash.digest("hex") };
}

export async function writeBlobFromBuffer(data: Buffer): Promise<WrittenBlob> {
  const id = newBlobId();
  const { final, tmp } = await prepare(id);
  await fsp.writeFile(tmp, encryptBuffer(blobKey(masterKey(), id), data), { mode: 0o600 });
  await fsp.rename(tmp, final);
  return { id, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
}

export async function openBlobReader(id: string): Promise<BlobReader> {
  return openBlob(blobPath(id), blobKey(masterKey(), id));
}

export async function readBlob(id: string): Promise<Buffer> {
  return decryptToBuffer(blobPath(id), blobKey(masterKey(), id));
}

export async function exportBlobToFile(id: string, dest: string): Promise<void> {
  return decryptToFile(blobPath(id), blobKey(masterKey(), id), dest);
}

export async function deleteBlob(id: string | undefined | null): Promise<void> {
  if (!id || !ID_RE.test(id)) return;
  await fsp.rm(blobPath(id), { force: true });
}

/** Per-job scratch directory for ffmpeg/sharp; always removed afterwards. */
export async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  await fsp.mkdir(config.workDir, { recursive: true, mode: 0o700 });
  const dir = await fsp.mkdtemp(path.join(config.workDir, "job-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
