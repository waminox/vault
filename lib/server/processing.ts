import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import exifReader from "exif-reader";
import { db } from "./db";
import { publish } from "./events";
import { extractFrame, hasFfmpeg, probe, storyboardFrames, transcodeToMp4 } from "./ffmpeg";
import { isUnsealed } from "./keyring";
import { findDuplicate, getItem, parseVariants, purgeItems, setProgress, updateItem, type ItemRow } from "./media";
import { BROWSER_AUDIO_CODECS, BROWSER_IMAGES, BROWSER_PLAYABLE_CONTAINERS, BROWSER_VIDEO_CODECS } from "./sniff";
import { deleteBlob, exportBlobToFile, withWorkDir, writeBlobFromBuffer, writeBlobFromFile } from "./storage";
import type { Variant, Variants } from "../types";

sharp.cache(false);
sharp.concurrency(2);

const THUMB_EDGE = 480;
const PREVIEW_EDGE = 2048;

export interface ClientMeta {
  duration?: number;
  width?: number;
  height?: number;
}

export interface IngestPayload {
  src: string;
  poster?: string;
  clientMeta?: ClientMeta;
}

// ─── Images ──────────────────────────────────────────────────────────────────

interface Derived {
  thumb: { data: Buffer; width: number; height: number };
  preview?: { data: Buffer; width: number; height: number };
  width: number;
  height: number;
  color: string | null;
  takenAt: number | null;
}

async function deriveImages(input: string | Buffer, { needPreview }: { needPreview: boolean }): Promise<Derived> {
  const base = () => sharp(input, { failOn: "error", animated: false }).rotate();
  const meta = await sharp(input, { failOn: "error" }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? 0;
  const height = (swap ? meta.width : meta.height) ?? 0;

  const thumb = await base()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: "outside", withoutEnlargement: true })
    .webp({ quality: 74, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  let preview: Derived["preview"];
  if (needPreview || Math.max(width, height) > PREVIEW_EDGE) {
    const p = await base()
      .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    preview = { data: p.data, width: p.info.width, height: p.info.height };
  }

  let color: string | null = null;
  try {
    const { dominant } = await sharp(thumb.data).stats();
    color = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  } catch {}

  let takenAt: number | null = null;
  if (meta.exif) {
    try {
      const exif = exifReader(meta.exif);
      const d = exif.Photo?.DateTimeOriginal ?? exif.Image?.DateTime;
      if (d instanceof Date && !Number.isNaN(d.getTime())) takenAt = d.getTime();
    } catch {}
  }

  return {
    thumb: { data: thumb.data, width: thumb.info.width, height: thumb.info.height },
    preview,
    width,
    height,
    color,
    takenAt,
  };
}

async function storeDerived(d: Derived, variants: Variants, posterToo = false): Promise<void> {
  const t = await writeBlobFromBuffer(d.thumb.data);
  variants.thumb = { blob: t.id, mime: "image/webp", size: t.size, width: d.thumb.width, height: d.thumb.height };
  if (d.preview) {
    const p = await writeBlobFromBuffer(d.preview.data);
    const v: Variant = { blob: p.id, mime: "image/webp", size: p.size, width: d.preview.width, height: d.preview.height };
    if (posterToo) variants.poster = v;
    else variants.preview = v;
  }
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

export async function ingest(item: ItemRow, payload: IngestPayload): Promise<void> {
  const variants: Variants = {};
  const written = () => Object.values(variants).map((v) => v?.blob);
  try {
    setProgress(item.id, 0.1);
    const original = await writeBlobFromFile(payload.src);
    variants.original = { blob: original.id, mime: item.mime, size: original.size };

    const dup = findDuplicate(original.sha256, item.id);
    if (dup) {
      for (const b of written()) await deleteBlob(b);
      await removeIngestFiles(payload);
      await purgeItems([item.id]);
      publish({ type: "item.duplicate", id: item.id, of: dup.id, name: item.name });
      return;
    }
    setProgress(item.id, 0.4);

    if (item.kind === "image") {
      const d = await deriveImages(payload.src, { needPreview: !BROWSER_IMAGES.has(item.mime) });
      await storeDerived(d, variants);
      await removeIngestFiles(payload);
      updateItem(item.id, {
        sha256: original.sha256,
        size: original.size,
        width: d.width,
        height: d.height,
        color: d.color,
        taken_at: d.takenAt ?? item.taken_at,
        variants,
        status: "ready",
        progress: null,
        error: null,
      });
      return;
    }

    // Video
    const info = await probe(payload.src).catch(() => null);
    const meta = payload.clientMeta ?? {};
    const duration = info?.duration ?? (meta.duration && meta.duration > 0 ? meta.duration : null);
    let derived: Derived | null = null;

    await withWorkDir(async (dir) => {
      let frame: string | null = null;
      if (hasFfmpeg()) {
        frame = path.join(dir, "frame.jpg");
        await extractFrame(payload.src, duration ? Math.min(duration * 0.1, 10) : 0, frame).catch(() => (frame = null));
      }
      if (!frame && payload.poster) frame = payload.poster; // poster captured by the browser, re-encoded below
      if (frame) derived = await deriveImages(frame, { needPreview: true }).catch(() => null);
    });
    if (derived) await storeDerived(derived, variants, true);

    const playable = info
      ? BROWSER_PLAYABLE_CONTAINERS.has(item.mime) &&
        BROWSER_VIDEO_CODECS.has(info.videoCodec ?? "") &&
        (!info.audioCodec || BROWSER_AUDIO_CODECS.has(info.audioCodec))
      : BROWSER_PLAYABLE_CONTAINERS.has(item.mime);
    const needsTranscode = !playable && hasFfmpeg();

    const d = derived as Derived | null;
    await removeIngestFiles(payload);
    updateItem(item.id, {
      sha256: original.sha256,
      size: original.size,
      width: info?.width ?? meta.width ?? d?.width ?? null,
      height: info?.height ?? meta.height ?? d?.height ?? null,
      duration,
      color: d?.color ?? null,
      taken_at: info?.createdAt ?? item.taken_at,
      variants,
      status: needsTranscode ? "processing" : "ready",
      progress: needsTranscode ? 0 : null,
      error: !playable && !needsTranscode ? "This format can't play in browsers. Install ffmpeg on the server to convert it, or download it." : null,
    });

    if (needsTranscode) enqueue(item.id, "transcode");
    if (hasFfmpeg() && duration && duration >= 8) enqueue(item.id, "storyboard");
  } catch (err) {
    // Keep the source so the job can be retried; purging the item removes it.
    for (const b of written()) await deleteBlob(b);
    throw err;
  }
}

export async function removeIngestFiles(payload: IngestPayload): Promise<void> {
  await fsp.rm(payload.src, { force: true });
  if (payload.poster) await fsp.rm(payload.poster, { force: true });
}

// ─── Video jobs ──────────────────────────────────────────────────────────────

async function transcode(item: ItemRow): Promise<void> {
  const variants = parseVariants(item);
  if (!variants.original) throw new Error("Original missing");
  await withWorkDir(async (dir) => {
    const input = path.join(dir, "in");
    const output = path.join(dir, "out.mp4");
    await exportBlobToFile(variants.original!.blob, input);
    await transcodeToMp4(input, output, item.duration, (p) => setProgress(item.id, p));
    const info = await probe(output).catch(() => null);
    const blob = await writeBlobFromFile(output);
    const fresh = getItem(item.id);
    if (!fresh) {
      await deleteBlob(blob.id);
      return;
    }
    const v = parseVariants(fresh);
    await deleteBlob(v.playback?.blob);
    v.playback = { blob: blob.id, mime: "video/mp4", size: blob.size, width: info?.width ?? undefined, height: info?.height ?? undefined };
    updateItem(item.id, { variants: v, status: "ready", progress: null, error: null });
  });
}

async function storyboard(item: ItemRow): Promise<void> {
  const variants = parseVariants(item);
  const source = variants.playback ?? variants.original;
  if (!source || !item.duration) return;
  const count = Math.min(100, Math.max(10, Math.floor(item.duration / 2)));
  const interval = item.duration / count;
  const cols = 10;
  const tileW = 160;
  await withWorkDir(async (dir) => {
    const input = path.join(dir, "in");
    await exportBlobToFile(source.blob, input);
    const frames = await storyboardFrames(input, dir, interval, count, tileW, item.duration!);
    if (!frames.length) throw new Error("No frames extracted");
    const first = await sharp(frames[0]).metadata();
    const tileH = first.height ?? Math.round((tileW * 9) / 16);
    const actualRows = Math.ceil(frames.length / cols);
    const sheet = await sharp({ create: { width: cols * tileW, height: actualRows * tileH, channels: 3, background: "#000" } })
      .composite(frames.map((f, i) => ({ input: f, left: (i % cols) * tileW, top: Math.floor(i / cols) * tileH })))
      .webp({ quality: 62 })
      .toBuffer();
    const blob = await writeBlobFromBuffer(sheet);
    const fresh = getItem(item.id);
    if (!fresh) {
      await deleteBlob(blob.id);
      return;
    }
    const v = parseVariants(fresh);
    await deleteBlob(v.storyboard?.blob);
    v.storyboard = { blob: blob.id, mime: "image/webp", size: blob.size, cols, rows: actualRows, interval, count: frames.length, tileW, tileH };
    updateItem(item.id, { variants: v });
  });
}

// ─── Queue ───────────────────────────────────────────────────────────────────

type JobType = "ingest" | "transcode" | "storyboard";
interface JobRow {
  id: number;
  item_id: string;
  type: JobType;
  payload: string | null;
  attempts: number;
}

const HEAVY = new Set<JobType>(["transcode", "storyboard"]);
const MAX_ATTEMPTS = 3;
const SLOTS = 2;

const g = globalThis as unknown as { __vaultQueue?: { running: Set<number>; heavy: number } };
const state = (g.__vaultQueue ??= { running: new Set(), heavy: 0 });

export function enqueue(itemId: string, type: JobType, payload?: unknown): void {
  const now = Date.now();
  db()
    .prepare("INSERT INTO jobs(item_id, type, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?)")
    .run(itemId, type, payload === undefined ? null : JSON.stringify(payload), now, now);
  kick();
}

/** On boot: anything that was mid-flight when the process died goes back in line. */
export function recoverJobs(): void {
  db().prepare("UPDATE jobs SET status = 'pending' WHERE status = 'running'").run();
  db().prepare("DELETE FROM jobs WHERE status = 'done' OR (status = 'failed' AND updated_at < ?)").run(Date.now() - 7 * 86400_000);
}

function nextJob(): JobRow | undefined {
  const running = [...state.running];
  const exclude = running.length ? `AND id NOT IN (${running.map(() => "?").join(",")})` : "";
  const heavyFilter = state.heavy > 0 ? "AND type NOT IN ('transcode','storyboard')" : "";
  return db()
    .prepare(
      `SELECT id, item_id, type, payload, attempts FROM jobs WHERE status = 'pending' ${exclude} ${heavyFilter}
       ORDER BY CASE type WHEN 'ingest' THEN 0 WHEN 'transcode' THEN 1 ELSE 2 END, id LIMIT 1`,
    )
    .get(...running) as JobRow | undefined;
}

async function runJob(job: JobRow): Promise<void> {
  const item = getItem(job.item_id);
  if (!item) return;
  switch (job.type) {
    case "ingest":
      return ingest(item, JSON.parse(job.payload ?? "{}") as IngestPayload);
    case "transcode":
      return transcode(item);
    case "storyboard":
      return storyboard(item);
  }
}

export function kick(): void {
  // Jobs need the master key to encrypt/decrypt: they wait while the vault is sealed.
  while (isUnsealed() && state.running.size < SLOTS) {
    const job = nextJob();
    if (!job) return;
    const heavy = HEAVY.has(job.type);
    state.running.add(job.id);
    if (heavy) state.heavy++;
    db().prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(Date.now(), job.id);

    runJob(job)
      .then(() => {
        db().prepare("UPDATE jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
      })
      .catch((err: Error) => {
        const sealed = !isUnsealed();
        const final = !sealed && job.attempts + 1 >= MAX_ATTEMPTS;
        console.error(`[vault] job ${job.type} #${job.id} failed${final ? " permanently" : ""}:`, err.message);
        db()
          .prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ?, attempts = CASE WHEN ? THEN attempts - 1 ELSE attempts END WHERE id = ?")
          .run(final ? "failed" : "pending", String(err.message).slice(0, 500), Date.now(), sealed ? 1 : 0, job.id);
        if (final) {
          const item = getItem(job.item_id);
          if (job.type === "storyboard") return; // cosmetic; the item stays usable
              if (item) {
            const usable = job.type === "transcode";
            updateItem(job.item_id, {
              status: usable ? "ready" : "failed",
              progress: null,
              error: usable ? `Couldn't convert for playback: ${err.message.slice(0, 160)}` : `Processing failed: ${err.message.slice(0, 160)}`,
            });
          }
        }
      })
      .finally(() => {
        state.running.delete(job.id);
        if (heavy) state.heavy--;
        setTimeout(kick, 50);
      });
  }
}

/** Retry processing for a failed item (re-runs the job that failed). */
export function retryItem(itemId: string): boolean {
  const job = db()
    .prepare("SELECT id FROM jobs WHERE item_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1")
    .get(itemId) as { id: number } | undefined;
  if (!job) return false;
  db().prepare("UPDATE jobs SET status = 'pending', attempts = 0, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
  updateItem(itemId, { status: "processing", progress: 0, error: null });
  kick();
  return true;
}

/** Re-process an existing original (used by the importer). */
export { deriveImages };
