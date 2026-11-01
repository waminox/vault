import path from "node:path";
import { execFileSync } from "node:child_process";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

function findBinary(envName: string, bin: string): string | null {
  const configured = process.env[envName];
  if (configured === "off") return null;
  const candidate = configured || bin;
  try {
    execFileSync(candidate, ["-version"], { stdio: "ignore", timeout: 5000 });
    return candidate;
  } catch {
    return null;
  }
}

const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.VAULT_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"));
const isProd = process.env.NODE_ENV === "production";

let ffmpegCache: { ffmpeg: string | null; ffprobe: string | null } | undefined;

export const config = {
  dataDir,
  dbPath: path.join(dataDir, "vault.db"),
  blobDir: path.join(dataDir, "blobs"),
  uploadDir: path.join(dataDir, "uploads"),
  workDir: path.join(dataDir, "work"),

  /** Hard ceiling for a single file. */
  maxUploadBytes: int("VAULT_MAX_UPLOAD_MB", 20 * 1024) * 1024 * 1024,
  /** Chunk size negotiated with the browser for resumable uploads. */
  chunkBytes: int("VAULT_CHUNK_MB", 8) * 1024 * 1024,
  /** Incomplete uploads are discarded after this long. */
  uploadTtlMs: int("VAULT_UPLOAD_TTL_HOURS", 48) * 3600_000,

  sessionIdleMs: int("VAULT_SESSION_IDLE_MINUTES", 60) * 60_000,
  sessionMaxMs: int("VAULT_SESSION_MAX_HOURS", 24 * 7) * 3600_000,
  cookieSecure: bool("VAULT_COOKIE_SECURE", isProd),
  trustProxy: bool("VAULT_TRUST_PROXY", false),

  trashDays: int("VAULT_TRASH_DAYS", 30),
  /** Browser cache lifetime for thumbnails/previews. 0 = never store on the device. */
  thumbCacheSeconds: int("VAULT_THUMB_CACHE_SECONDS", 3600),

  /** scrypt cost (log2 N). 17 ≈ 128 MiB RAM, ~0.3 s per attempt. */
  kdfLogN: int("VAULT_KDF_LOGN", 17),

  get media() {
    ffmpegCache ??= {
      ffmpeg: findBinary("VAULT_FFMPEG", "ffmpeg"),
      ffprobe: findBinary("VAULT_FFPROBE", "ffprobe"),
    };
    return ffmpegCache;
  },
};

export const COOKIE_NAME = config.cookieSecure ? "__Host-vault" : "vault";
