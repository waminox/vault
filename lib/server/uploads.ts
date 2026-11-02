import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import { ApiError } from "./http";
import { getAlbum, insertItem, newId, toDTO } from "./media";
import { enqueue, type ClientMeta, type IngestPayload } from "./processing";
import { sniff } from "./sniff";
import type { ItemDTO, UploadStatus } from "../types";

/**
 * Resumable, chunked uploads.
 *
 *   POST   /api/uploads                 → create (or resume) a session
 *   PUT    /api/uploads/:id/chunks/:n   → write chunk n (verified by SHA-256)
 *   PUT    /api/uploads/:id/poster      → optional browser-generated video poster
 *   POST   /api/uploads/:id/complete    → sniff, register, queue for encryption
 *
 * Chunks may arrive in any order and in parallel; each is written straight to
 * its offset in a pre-sized file, so completing never re-copies data.
 */

const UPLOAD_ID = /^[a-f0-9]{32}$/;
const MAX_ACTIVE = 64;
const MAX_POSTER = 8 * 1024 * 1024;

interface UploadRow {
  id: string;
  name: string;
  size: number;
  chunk_size: number;
  total_chunks: number;
  album_id: string | null;
  last_modified: number | null;
  created_at: number;
  expires_at: number;
  client_meta: string | null;
}

export function sanitizeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, 200);
  return clean || "untitled";
}

function dirFor(id: string): string {
  if (!UPLOAD_ID.test(id)) throw new ApiError(400, "Invalid upload id");
  return path.join(config.uploadDir, id);
}

function getUpload(id: string): UploadRow {
  if (!UPLOAD_ID.test(id)) throw new ApiError(400, "Invalid upload id");
  const row = db().prepare("SELECT * FROM uploads WHERE id = ?").get(id) as UploadRow | undefined;
  if (!row || row.expires_at < Date.now()) throw new ApiError(404, "Upload not found or expired");
  return row;
}

function received(id: string): number[] {
  return (db().prepare("SELECT idx FROM upload_chunks WHERE upload_id = ? ORDER BY idx").all(id) as { idx: number }[]).map((r) => r.idx);
}

export function status(id: string): UploadStatus {
  const u = getUpload(id);
  return { id: u.id, chunkSize: u.chunk_size, totalChunks: u.total_chunks, received: received(id) };
}

export async function createUpload(input: {
  name: string;
  size: number;
  albumId: string | null;
  lastModified?: number;
  resumeId?: string;
}): Promise<UploadStatus> {
  // Resume: same file (name + size) re-selected after a reload or network drop.
  if (input.resumeId && UPLOAD_ID.test(input.resumeId)) {
    const row = db().prepare("SELECT * FROM uploads WHERE id = ?").get(input.resumeId) as UploadRow | undefined;
    if (row && row.expires_at > Date.now() && row.size === input.size && row.name === sanitizeName(input.name)) {
      db().prepare("UPDATE uploads SET expires_at = ?, album_id = ? WHERE id = ?").run(Date.now() + config.uploadTtlMs, input.albumId, row.id);
      return status(row.id);
    }
  }

  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new ApiError(400, "Empty file");
  if (input.size > config.maxUploadBytes) {
    throw new ApiError(413, `File is larger than the ${Math.round(config.maxUploadBytes / 1024 ** 3)} GB limit`);
  }
  if (input.albumId && !getAlbum(input.albumId)) throw new ApiError(404, "Album not found");
  const { n } = db().prepare("SELECT COUNT(*) AS n FROM uploads WHERE expires_at > ?").get(Date.now()) as { n: number };
  if (n >= MAX_ACTIVE) throw new ApiError(429, "Too many uploads in progress");

  const id = crypto.randomBytes(16).toString("hex");
  const chunkSize = config.chunkBytes;
  const total = Math.ceil(input.size / chunkSize);
  const dir = dirFor(id);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  // Pre-size the target so chunks can land at their offsets in any order.
  const fh = await fsp.open(path.join(dir, "data"), "w", 0o600);
  await fh.truncate(input.size);
  await fh.close();

  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO uploads(id, name, size, chunk_size, total_chunks, album_id, last_modified, created_at, expires_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, sanitizeName(input.name), input.size, chunkSize, total, input.albumId, input.lastModified ?? null, now, now + config.uploadTtlMs);
  return { id, chunkSize, totalChunks: total, received: [] };
}

/** Read a request body into memory, refusing anything bigger than `limit`. */
async function readBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!body) throw new ApiError(400, "Missing body");
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    len += value.length;
    if (len > limit) {
      await reader.cancel();
      throw new ApiError(413, "Chunk larger than expected");
    }
    parts.push(value);
  }
  return Buffer.concat(parts, len);
}

export async function writeChunk(id: string, index: number, body: ReadableStream<Uint8Array> | null, sha256?: string | null): Promise<UploadStatus> {
  const u = getUpload(id);
  if (!Number.isInteger(index) || index < 0 || index >= u.total_chunks) throw new ApiError(400, "Chunk index out of range");
  const expected = index === u.total_chunks - 1 ? u.size - index * u.chunk_size : u.chunk_size;
  const data = await readBody(body, expected);
  if (data.length !== expected) throw new ApiError(400, `Chunk ${index} has ${data.length} bytes, expected ${expected}`);
  if (sha256) {
    const actual = crypto.createHash("sha256").update(data).digest("hex");
    if (actual !== sha256.toLowerCase()) throw new ApiError(422, `Chunk ${index} was corrupted in transit`, { retry: true });
  }
  const fh = await fsp.open(path.join(dirFor(id), "data"), "r+");
  try {
    await fh.write(data, 0, data.length, index * u.chunk_size);
    await fh.datasync();
  } finally {
    await fh.close();
  }
  db().prepare("INSERT OR IGNORE INTO upload_chunks(upload_id, idx) VALUES(?, ?)").run(id, index);
  db().prepare("UPDATE uploads SET expires_at = ? WHERE id = ?").run(Date.now() + config.uploadTtlMs, id);
  return status(id);
}

export async function writePoster(id: string, body: ReadableStream<Uint8Array> | null): Promise<void> {
  getUpload(id);
  const data = await readBody(body, MAX_POSTER);
  // Only stored as a hint; it is decoded and re-encoded by sharp before use.
  await fsp.writeFile(path.join(dirFor(id), "poster"), data, { mode: 0o600 });
}

export async function completeUpload(id: string, clientMeta?: ClientMeta): Promise<ItemDTO> {
  const u = getUpload(id);
  const got = received(id);
  if (got.length !== u.total_chunks) {
    throw new ApiError(409, `Upload incomplete (${got.length}/${u.total_chunks} chunks)`, { received: got });
  }
  const dir = dirFor(id);
  const dataPath = path.join(dir, "data");

  const head = Buffer.alloc(4096);
  const fh = await fsp.open(dataPath, "r");
  const { bytesRead } = await fh.read(head, 0, head.length, 0);
  await fh.close();
  const kind = sniff(head.subarray(0, bytesRead));
  if (!kind) {
    await abortUpload(id);
    throw new ApiError(415, "Unsupported file type. Photos (JPEG, PNG, GIF, WebP, AVIF, HEIC, TIFF) and videos only.");
  }

  const itemId = newId();
  await fsp.mkdir(config.workDir, { recursive: true, mode: 0o700 });
  const src = path.join(config.workDir, `ingest-${itemId}`);
  await fsp.rename(dataPath, src);
  let poster: string | undefined;
  if (kind.kind === "video" && fs.existsSync(path.join(dir, "poster"))) {
    poster = `${src}.poster`;
    await fsp.rename(path.join(dir, "poster"), poster);
  }

  const item = insertItem({
    id: itemId,
    albumId: u.album_id && getAlbum(u.album_id) ? u.album_id : null,
    kind: kind.kind,
    name: u.name,
    mime: kind.mime,
    size: u.size,
    takenAt: u.last_modified,
  });
  const meta: ClientMeta = {};
  for (const k of ["duration", "width", "height"] as const) {
    const v = clientMeta?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e7) meta[k] = v;
  }
  const payload: IngestPayload = { src, poster, clientMeta: meta };
  enqueue(item.id, "ingest", payload);

  db().prepare("DELETE FROM uploads WHERE id = ?").run(id);
  await fsp.rm(dir, { recursive: true, force: true });
  return toDTO(item);
}

export async function abortUpload(id: string): Promise<void> {
  const dir = dirFor(id);
  db().prepare("DELETE FROM uploads WHERE id = ?").run(id);
  await fsp.rm(dir, { recursive: true, force: true });
}

export async function cleanupExpiredUploads(): Promise<void> {
  const rows = db().prepare("SELECT id FROM uploads WHERE expires_at < ?").all(Date.now()) as { id: string }[];
  for (const r of rows) await abortUpload(r.id);
  // Orphaned directories (e.g. DB restored from backup).
  try {
    const known = new Set((db().prepare("SELECT id FROM uploads").all() as { id: string }[]).map((r) => r.id));
    for (const entry of await fsp.readdir(config.uploadDir)) {
      if (UPLOAD_ID.test(entry) && !known.has(entry)) await fsp.rm(path.join(config.uploadDir, entry), { recursive: true, force: true });
    }
  } catch {}
}
