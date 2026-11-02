import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Transform, type TransformCallback } from "node:stream";

/*
 * ─── Key hierarchy ──────────────────────────────────────────────────────────
 *
 *   passphrase ──scrypt──▶ KEK ──AES-256-GCM unwrap──▶ master key (MK, random 256-bit)
 *   MK ──HKDF-SHA256(info = blob id)──▶ per-blob key
 *
 * Changing the passphrase only re-wraps the MK. The MK lives in process memory
 * while the vault is unlocked and is wiped when the last session ends.
 *
 * ─── Blob format (v1) ───────────────────────────────────────────────────────
 *
 *   header (16 bytes): "VLT1" | ver=1 | log2(chunk) | 0 0 | nonce prefix (7) | 0
 *   body: N chunks, each = AES-256-GCM(plaintext ≤ 64 KiB) ‖ 16-byte tag
 *
 *   chunk nonce = prefix(7) ‖ uint32be(index) ‖ lastFlag(1)
 *   AAD         = header
 *
 * The STREAM-style nonce binds each chunk to its position and marks the final
 * chunk, so reordering, dropping or truncating chunks fails authentication.
 * Fixed-size chunks give O(1) random access → cheap HTTP Range for video seeking.
 */

const MAGIC = Buffer.from("VLT1", "ascii");
export const HEADER_LEN = 16;
const TAG_LEN = 16;
const DEFAULT_CHUNK_LOG2 = 16; // 64 KiB
const WRAP_AAD = Buffer.from("vault/master-key/v1");

// ─── Passphrase → KEK ────────────────────────────────────────────────────────

export interface KdfParams {
  alg: "scrypt";
  logN: number;
  r: number;
  p: number;
  salt: string; // base64
}

export function newKdfParams(logN: number): KdfParams {
  return { alg: "scrypt", logN, r: 8, p: 1, salt: crypto.randomBytes(16).toString("base64") };
}

export function deriveKek(passphrase: string, params: KdfParams): Promise<Buffer> {
  const N = 2 ** params.logN;
  const maxmem = 256 * N * params.r + 1024 * 1024; // 2x what scrypt needs
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      passphrase.normalize("NFKC"),
      Buffer.from(params.salt, "base64"),
      32,
      { N, r: params.r, p: params.p, maxmem },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

// ─── Small authenticated envelopes (key wrapping, secrets) ───────────────────

export function sealBytes(plaintext: Buffer, key: Buffer, aad: Buffer = WRAP_AAD): string {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]).toString("base64");
}

export function openBytes(sealed: string, key: Buffer, aad: Buffer = WRAP_AAD): Buffer | null {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < 12 + TAG_LEN) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAAD(aad);
    d.setAuthTag(raw.subarray(raw.length - TAG_LEN));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - TAG_LEN)), d.final()]);
  } catch {
    return null;
  }
}

export function blobKey(masterKey: Buffer, blobId: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), `vault/blob/v1/${blobId}`, 32));
}

// ─── Streaming chunked AEAD ──────────────────────────────────────────────────

function chunkNonce(prefix: Buffer, index: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 7);
  n.writeUInt32BE(index, 7);
  n[11] = last ? 1 : 0;
  return n;
}

function makeHeader(chunkLog2: number): Buffer {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h[4] = 1;
  h[5] = chunkLog2;
  crypto.randomBytes(7).copy(h, 8);
  return h;
}

function parseHeader(h: Buffer): { chunkSize: number; prefix: Buffer } {
  if (h.length < HEADER_LEN || !h.subarray(0, 4).equals(MAGIC) || h[4] !== 1) {
    throw new Error("Not a vault blob (bad header)");
  }
  const log2 = h[5];
  if (log2 < 10 || log2 > 24) throw new Error("Unsupported chunk size");
  return { chunkSize: 1 << log2, prefix: h.subarray(8, 15) };
}

function encryptChunk(key: Buffer, header: Buffer, prefix: Buffer, index: number, last: boolean, data: Buffer): Buffer {
  const c = crypto.createCipheriv("aes-256-gcm", key, chunkNonce(prefix, index, last));
  c.setAAD(header);
  return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
}

function decryptChunk(key: Buffer, header: Buffer, prefix: Buffer, index: number, last: boolean, data: Buffer): Buffer {
  const d = crypto.createDecipheriv("aes-256-gcm", key, chunkNonce(prefix, index, last));
  d.setAAD(header);
  d.setAuthTag(data.subarray(data.length - TAG_LEN));
  try {
    return Buffer.concat([d.update(data.subarray(0, data.length - TAG_LEN)), d.final()]);
  } catch {
    throw new Error(`Blob integrity check failed at chunk ${index}`);
  }
}

/** Transform: plaintext in → vault blob out. */
export function createEncryptStream(key: Buffer, chunkLog2 = DEFAULT_CHUNK_LOG2): Transform {
  const header = makeHeader(chunkLog2);
  const { chunkSize, prefix } = parseHeader(header);
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let index = 0;
  let headerSent = false;

  const take = (n: number): Buffer => {
    const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingLen);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    pending = rest.length ? [rest] : [];
    pendingLen = rest.length;
    return out;
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!headerSent) {
        this.push(header);
        headerSent = true;
      }
      pending.push(chunk);
      pendingLen += chunk.length;
      // Always hold back at least one byte so the final chunk is flagged correctly.
      while (pendingLen > chunkSize) {
        this.push(encryptChunk(key, header, prefix, index++, false, take(chunkSize)));
      }
      cb();
    },
    flush(cb: TransformCallback) {
      if (!headerSent) this.push(header);
      this.push(encryptChunk(key, header, prefix, index++, true, take(pendingLen)));
      cb();
    },
  });
}

export function encryptBuffer(key: Buffer, data: Buffer, chunkLog2 = DEFAULT_CHUNK_LOG2): Buffer {
  const header = makeHeader(chunkLog2);
  const { chunkSize, prefix } = parseHeader(header);
  const parts = [header];
  const n = Math.max(1, Math.ceil(data.length / chunkSize));
  for (let i = 0; i < n; i++) {
    parts.push(encryptChunk(key, header, prefix, i, i === n - 1, data.subarray(i * chunkSize, (i + 1) * chunkSize)));
  }
  return Buffer.concat(parts);
}

export function plaintextLength(cipherLen: number, chunkSize = 1 << DEFAULT_CHUNK_LOG2): number {
  const body = cipherLen - HEADER_LEN;
  if (body < TAG_LEN) throw new Error("Truncated blob");
  const n = Math.ceil(body / (chunkSize + TAG_LEN));
  return body - n * TAG_LEN;
}

export interface BlobReader {
  size: number;
  read(start: number, endInclusive: number): AsyncGenerator<Buffer>;
  close(): Promise<void>;
}

/** Random-access decrypting reader over a blob file. */
export async function openBlob(filePath: string, key: Buffer): Promise<BlobReader> {
  const fh = await fsp.open(filePath, "r");
  try {
    const { size: fileSize } = await fh.stat();
    const header = Buffer.alloc(HEADER_LEN);
    await fh.read(header, 0, HEADER_LEN, 0);
    const { chunkSize, prefix } = parseHeader(header);
    const stride = chunkSize + TAG_LEN;
    const size = plaintextLength(fileSize, chunkSize);
    const nChunks = Math.ceil((fileSize - HEADER_LEN) / stride);
    const BATCH = 16; // read up to 1 MiB of ciphertext per syscall

    async function* read(start: number, endInclusive: number): AsyncGenerator<Buffer> {
      if (size === 0 || start > endInclusive) return;
      if (start < 0 || endInclusive >= size) throw new RangeError("Range outside blob");
      const first = Math.floor(start / chunkSize);
      const last = Math.floor(endInclusive / chunkSize);
      for (let i = first; i <= last; i += BATCH) {
        const count = Math.min(BATCH, last - i + 1);
        const offset = HEADER_LEN + i * stride;
        const len = Math.min(count * stride, fileSize - offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, offset);
        if (bytesRead !== len) throw new Error("Short read from blob");
        for (let j = 0; j < count; j++) {
          const idx = i + j;
          const plain = decryptChunk(key, header, prefix, idx, idx === nChunks - 1, buf.subarray(j * stride, Math.min((j + 1) * stride, len)));
          const base = idx * chunkSize;
          const from = Math.max(0, start - base);
          const to = Math.min(plain.length, endInclusive - base + 1);
          yield plain.subarray(from, to);
        }
      }
    }

    // Validate the final chunk up-front so truncation is caught even for partial reads.
    if (size > 0) {
      const lastOffset = HEADER_LEN + (nChunks - 1) * stride;
      const tail = Buffer.alloc(fileSize - lastOffset);
      await fh.read(tail, 0, tail.length, lastOffset);
      decryptChunk(key, header, prefix, nChunks - 1, true, tail);
    } else {
      const tail = Buffer.alloc(TAG_LEN);
      await fh.read(tail, 0, TAG_LEN, HEADER_LEN);
      decryptChunk(key, header, prefix, 0, true, tail);
    }

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await fh.close();
    };
    return { size, read, close };
  } catch (err) {
    await fh.close();
    throw err;
  }
}

export async function decryptToBuffer(filePath: string, key: Buffer): Promise<Buffer> {
  const r = await openBlob(filePath, key);
  try {
    const parts: Buffer[] = [];
    for await (const p of r.read(0, r.size - 1)) parts.push(p);
    return Buffer.concat(parts, r.size);
  } finally {
    await r.close();
  }
}

export async function decryptToFile(filePath: string, key: Buffer, dest: string): Promise<void> {
  const r = await openBlob(filePath, key);
  const out = fs.createWriteStream(dest, { mode: 0o600 });
  try {
    for await (const p of r.read(0, r.size - 1)) {
      if (!out.write(p)) await new Promise<void>((res) => out.once("drain", () => res()));
    }
  } finally {
    await r.close();
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
  }
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
