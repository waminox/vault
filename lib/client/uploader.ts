"use client";

import { BASE, HttpError, api, sessionLost } from "./api";
import { lsGet, lsSet } from "./prefs";
import type { ItemDTO, UploadStatus } from "../types";

/**
 * Resumable upload engine.
 *  • files are split into server-negotiated chunks, several in flight at once
 *  • every chunk carries a SHA-256 the server verifies (corruption → retry)
 *  • transient failures back off exponentially; going offline pauses, coming back resumes
 *  • sessions survive reloads: re-adding the same file continues where it stopped
 *  • videos get a poster frame + metadata captured in the browser (server fallback when no ffmpeg)
 */

export type UploadState = "queued" | "uploading" | "paused" | "finalizing" | "done" | "error" | "canceled";

export interface UploadTask {
  key: string;
  file: File;
  name: string;
  albumId: string | null;
  state: UploadState;
  loaded: number;
  total: number;
  speed: number;
  error?: string;
  /** The server rejected the file itself; retrying can't help. */
  fatal?: boolean;
  item?: ItemDTO;
  startedAt?: number;
}

const FILES_IN_PARALLEL = 2;
const CHUNKS_IN_PARALLEL = 3;
const MAX_ATTEMPTS = 7;
const RESUME_KEY = "vault:resume";

function fingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // not a secure context (plain-http LAN)
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Capture a poster frame + metadata from a local video file. */
async function inspectVideo(file: File): Promise<{ poster: Blob | null; duration?: number; width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";
  v.src = url;
  const once = (ev: string, ms: number) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), ms);
      v.addEventListener(ev, () => (clearTimeout(t), res()), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), rej(new Error("decode"))), { once: true });
    });
  try {
    await once("loadedmetadata", 10_000);
    const meta = { duration: Number.isFinite(v.duration) ? v.duration : undefined, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
    try {
      v.currentTime = Math.min((v.duration || 0) * 0.1, 10);
      await once("seeked", 10_000);
      const scale = Math.min(1, 1280 / (v.videoWidth || 1280));
      const c = document.createElement("canvas");
      c.width = Math.round((v.videoWidth || 1280) * scale);
      c.height = Math.round((v.videoHeight || 720) * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const poster = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.86));
      return { poster, ...meta };
    } catch {
      return { poster: null, ...meta };
    }
  } catch {
    return { poster: null };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

function putChunk(url: string, body: Blob, sha: string | null, onProgress: (n: number) => void, signal: AbortSignal): Promise<UploadStatus> {
  // XHR rather than fetch: it reports upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    if (sha) xhr.setRequestHeader("X-Chunk-SHA256", sha);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as UploadStatus);
      else reject(new HttpError(xhr.status, String(data.error ?? `HTTP ${xhr.status}`), data));
    };
    xhr.onerror = () => reject(new HttpError(0, "Network error"));
    xhr.ontimeout = () => reject(new HttpError(0, "Timed out"));
    xhr.timeout = 5 * 60_000;
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.send(body);
  });
}

const retryable = (e: unknown) => e instanceof HttpError && (e.status === 0 || e.status === 408 || e.status === 422 || e.status === 429 || e.status >= 500);

export class Uploader {
  tasks: UploadTask[] = [];
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private snapshot: UploadTask[] = [];
  private wakeLock: { release(): Promise<void> } | null = null;
  onItem?: (item: ItemDTO) => void;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.pump());
      window.addEventListener("beforeunload", (e) => {
        if (this.active().length) e.preventDefault();
      });
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.tasks];
    this.listeners.forEach((l) => l());
  }

  private patch(key: string, p: Partial<UploadTask>) {
    this.tasks = this.tasks.map((t) => (t.key === key ? { ...t, ...p } : t));
    this.emit();
  }

  private get(key: string) {
    return this.tasks.find((t) => t.key === key);
  }

  active() {
    return this.tasks.filter((t) => t.state === "uploading" || t.state === "finalizing" || t.state === "queued");
  }

  /** Returns the number of files accepted. */
  add(files: File[], albumId: string | null): { accepted: number; skipped: number } {
    let skipped = 0;
    const fresh: UploadTask[] = [];
    for (const file of files) {
      const t = file.type;
      // Obvious non-media is skipped early; anything ambiguous goes to the server, which decides by content.
      if (t && !t.startsWith("image/") && !t.startsWith("video/") && t !== "application/octet-stream") {
        skipped++;
        continue;
      }
      const key = `${fingerprint(file)}#${Math.random().toString(36).slice(2, 8)}`;
      const dup = this.tasks.find((x) => fingerprint(x.file) === fingerprint(file) && x.state !== "done" && x.state !== "canceled" && x.state !== "error");
      if (dup) {
        skipped++;
        continue;
      }
      fresh.push({ key, file, name: file.name, albumId, state: "queued", loaded: 0, total: file.size, speed: 0 });
    }
    this.tasks = [...this.tasks, ...fresh];
    this.emit();
    this.pump();
    return { accepted: fresh.length, skipped };
  }

  pause(key: string) {
    const t = this.get(key);
    if (!t || (t.state !== "uploading" && t.state !== "queued")) return;
    this.controllers.get(key)?.abort();
    this.patch(key, { state: "paused", speed: 0 });
    this.pump();
  }

  resume(key: string) {
    const t = this.get(key);
    if (!t || (t.state !== "paused" && t.state !== "error") || t.fatal) return;
    this.patch(key, { state: "queued", error: undefined });
    this.pump();
  }

  cancel(key: string) {
    const t = this.get(key);
    if (!t) return;
    this.controllers.get(key)?.abort();
    const map = lsGet<Record<string, string>>(RESUME_KEY, {});
    const id = map[fingerprint(t.file)];
    if (id && t.state !== "done") {
      api(`/api/uploads/${id}`, { method: "DELETE" }).catch(() => {});
      delete map[fingerprint(t.file)];
      lsSet(RESUME_KEY, map);
    }
    this.patch(key, { state: "canceled", speed: 0 });
    this.pump();
  }

  pauseAll() {
    this.tasks.filter((t) => t.state === "uploading" || t.state === "queued").forEach((t) => this.pause(t.key));
  }
  resumeAll() {
    this.tasks.filter((t) => t.state === "paused" || t.state === "error").forEach((t) => this.resume(t.key));
  }

  clearFinished() {
    this.tasks = this.tasks.filter((t) => t.state !== "done" && t.state !== "canceled" && !t.fatal);
    this.emit();
  }

  private async pump() {
    const running = this.tasks.filter((t) => t.state === "uploading" || t.state === "finalizing").length;
    const slots = FILES_IN_PARALLEL - running;
    if (slots <= 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const next = this.tasks.filter((t) => t.state === "queued").slice(0, slots);
    next.forEach((t) => void this.run(t.key));
    this.updateWakeLock();
  }

  private async updateWakeLock() {
    const busy = this.active().length > 0;
    try {
      if (busy && !this.wakeLock && "wakeLock" in navigator) {
        this.wakeLock = await (navigator as Navigator & { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen");
      } else if (!busy && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {}
  }

  private async run(key: string) {
    const task = this.get(key);
    if (!task) return;
    const ctrl = new AbortController();
    this.controllers.set(key, ctrl);
    this.patch(key, { state: "uploading", startedAt: Date.now(), error: undefined });
    const file = task.file;
    const fp = fingerprint(file);

    try {
      const map = lsGet<Record<string, string>>(RESUME_KEY, {});
      const session = await api<UploadStatus>("/api/uploads", {
        method: "POST",
        json: { name: file.name, size: file.size, albumId: task.albumId, lastModified: file.lastModified || undefined, resumeId: map[fp] },
        signal: ctrl.signal,
      });
      lsSet(RESUME_KEY, { ...lsGet<Record<string, string>>(RESUME_KEY, {}), [fp]: session.id });

      const isVideo = file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|3gp|ogv|ts)$/i.test(file.name);
      const videoInfo = isVideo ? inspectVideo(file) : null;
      void videoInfo?.then((info) => {
        if (info.poster) fetch(`${BASE}/api/uploads/${session.id}/poster`, { method: "PUT", body: info.poster, credentials: "same-origin" }).catch(() => {});
      });

      const done = new Set(session.received);
      const inFlight = new Map<number, number>();
      const chunkLen = (i: number) => Math.min(session.chunkSize, file.size - i * session.chunkSize);
      let confirmed = [...done].reduce((s, i) => s + chunkLen(i), 0);
      let lastTick = performance.now();
      let lastBytes = confirmed;
      let speed = 0;
      const report = () => {
        const loaded = confirmed + [...inFlight.values()].reduce((a, b) => a + b, 0);
        const now = performance.now();
        if (now - lastTick > 400) {
          const inst = ((loaded - lastBytes) * 1000) / (now - lastTick);
          speed = speed ? speed * 0.7 + inst * 0.3 : inst;
          lastTick = now;
          lastBytes = loaded;
        }
        this.patch(key, { loaded: Math.min(loaded, file.size), speed: Math.max(0, speed) });
      };
      report();

      const queue = [...Array(session.totalChunks).keys()].filter((i) => !done.has(i));
      const worker = async () => {
        for (;;) {
          const i = queue.shift();
          if (i === undefined) return;
          const blob = file.slice(i * session.chunkSize, i * session.chunkSize + chunkLen(i));
          const sha = await sha256Hex(await blob.arrayBuffer());
          for (let attempt = 1; ; attempt++) {
            if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
            try {
              await putChunk(`${BASE}/api/uploads/${session.id}/chunks/${i}`, blob, sha, (n) => (inFlight.set(i, n), report()), ctrl.signal);
              inFlight.delete(i);
              confirmed += chunkLen(i);
              report();
              break;
            } catch (e) {
              inFlight.delete(i);
              if (e instanceof HttpError && e.status === 401) throw e;
              if (!retryable(e) || attempt >= MAX_ATTEMPTS) throw e;
              if (!navigator.onLine) await new Promise((r) => window.addEventListener("online", r, { once: true }));
              await sleep(Math.min(30_000, 800 * 2 ** (attempt - 1)) + Math.random() * 400);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: CHUNKS_IN_PARALLEL }, worker));

      this.patch(key, { state: "finalizing", loaded: file.size, speed: 0 });
      const info = videoInfo ? await Promise.race([videoInfo, sleep(4000).then(() => null)]) : null;
      if (info?.poster) await sleep(300); // give the poster PUT a head start
      const { item } = await api<{ item: ItemDTO }>(`/api/uploads/${session.id}/complete`, {
        method: "POST",
        json: { meta: info ? { duration: info.duration, width: info.width, height: info.height } : undefined },
      });
      const m = lsGet<Record<string, string>>(RESUME_KEY, {});
      delete m[fp];
      lsSet(RESUME_KEY, m);
      this.patch(key, { state: "done", item });
      this.onItem?.(item);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // paused / canceled; state already set
      if (e instanceof HttpError && e.status === 401) {
        this.patch(key, { state: "paused", error: "Locked — sign in to continue" });
        sessionLost();
        return;
      }
      if (e instanceof HttpError && (e.status === 404 || e.status === 415 || e.status === 413)) {
        const m = lsGet<Record<string, string>>(RESUME_KEY, {});
        delete m[fp];
        lsSet(RESUME_KEY, m);
      }
      const fatal = e instanceof HttpError && [400, 404, 413, 415].includes(e.status);
      this.patch(key, { state: "error", error: (e as Error).message, speed: 0, fatal });
    } finally {
      this.controllers.delete(key);
      this.pump();
      this.updateWakeLock();
    }
  }
}
