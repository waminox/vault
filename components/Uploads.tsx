"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, ChevronDown, CircleAlert, CloudUpload, Pause, Play, RotateCw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatBytes } from "@/lib/client/format";
import type { Uploader, UploadTask } from "@/lib/client/uploader";
import { IconButton, cx } from "./ui";

export function useUploads(u: Uploader): UploadTask[] {
  return useSyncExternalStore(u.subscribe, u.getSnapshot, u.getSnapshot);
}

function eta(t: UploadTask): string {
  if (!t.speed || t.speed < 1) return "";
  const s = (t.total - t.loaded) / t.speed;
  if (s < 60) return `${Math.ceil(s)}s left`;
  if (s < 3600) return `${Math.ceil(s / 60)} min left`;
  return `${(s / 3600).toFixed(1)} h left`;
}

export function UploadTray({ uploader }: { uploader: Uploader }) {
  const tasks = useUploads(uploader).filter((t) => t.state !== "canceled");
  const [collapsed, setCollapsed] = useState(false);
  const active = tasks.filter((t) => t.state === "uploading" || t.state === "queued" || t.state === "finalizing");
  const errors = tasks.filter((t) => t.state === "error" && !t.fatal);
  const rejected = tasks.filter((t) => t.fatal);
  const done = tasks.filter((t) => t.state === "done");
  const total = tasks.reduce((s, t) => s + t.total, 0);
  const loaded = tasks.reduce((s, t) => s + (t.state === "done" ? t.total : t.loaded), 0);
  const speed = active.reduce((s, t) => s + t.speed, 0);

  // Tidy up automatically a while after everything finished cleanly.
  useEffect(() => {
    if (!tasks.length || active.length || errors.length || tasks.some((t) => t.state === "paused")) return;
    const t = setTimeout(() => uploader.clearFinished(), 6000);
    return () => clearTimeout(t);
  }, [tasks, active.length, errors.length, uploader]);

  if (!tasks.length) return null;
  const pct = total ? (loaded / total) * 100 : 0;
  const title = active.length
    ? `Uploading · ${done.length} of ${tasks.length} done`
    : errors.length
      ? `${errors.length} upload${errors.length > 1 ? "s need" : " needs"} attention`
      : rejected.length && !done.length
        ? `${rejected.length} file${rejected.length > 1 ? "s" : ""} rejected`
      : tasks.some((t) => t.state === "paused")
        ? "Uploads paused"
        : `${done.length} uploaded`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass fixed right-3 bottom-3 z-[60] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl shadow-2xl shadow-black/50 sm:right-5 sm:bottom-5"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative flex size-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
          {active.length ? <CloudUpload className="size-[18px]" /> : errors.length ? <CircleAlert className="size-[18px] text-red-300" /> : <CheckCircle2 className="size-[18px] text-emerald-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-ink-400">
            {formatBytes(loaded)} of {formatBytes(total)}
            {speed > 0 && ` · ${formatBytes(speed)}/s`}
          </p>
        </div>
        {active.length > 0 ? (
          <IconButton label="Pause all" onClick={() => uploader.pauseAll()}>
            <Pause className="size-4" />
          </IconButton>
        ) : tasks.some((t) => t.state === "paused" || t.state === "error") ? (
          <IconButton label="Resume all" onClick={() => uploader.resumeAll()}>
            <Play className="size-4" />
          </IconButton>
        ) : null}
        <IconButton label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)}>
          <ChevronDown className={cx("size-4 transition-transform", collapsed && "rotate-180")} />
        </IconButton>
        {!active.length && (
          <IconButton label="Dismiss" onClick={() => uploader.clearFinished()}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="h-0.5 bg-white/[0.05]">
        <div className="h-full bg-gradient-to-r from-accent-500 to-cyan-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="max-h-72 overflow-y-auto">
            {tasks.map((t) => (
              <li key={t.key} className="flex items-center gap-3 border-t border-white/[0.04] px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{t.name}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className={cx(
                          "h-full rounded-full transition-[width] duration-300",
                          t.state === "error" ? "bg-red-400" : t.state === "done" ? "bg-emerald-400" : t.state === "paused" ? "bg-ink-400" : "bg-accent-500",
                          t.state === "finalizing" && "animate-pulse",
                        )}
                        style={{ width: `${t.state === "done" ? 100 : (t.loaded / Math.max(1, t.total)) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 truncate text-right text-[11px] text-ink-400">
                      {t.state === "uploading"
                        ? eta(t) || `${Math.round((t.loaded / Math.max(1, t.total)) * 100)}%`
                        : t.state === "finalizing"
                          ? "Sealing…"
                          : t.state === "queued"
                            ? "Waiting"
                            : t.state === "paused"
                              ? "Paused"
                              : t.state === "done"
                                ? "Encrypted"
                                : t.fatal
                                  ? "Rejected"
                                  : "Failed"}
                    </span>
                  </div>
                  {t.error && <p className="mt-1 truncate text-[11px] text-red-300" title={t.error}>{t.error}</p>}
                </div>
                {(t.state === "uploading" || t.state === "queued") && (
                  <IconButton label="Pause" onClick={() => uploader.pause(t.key)} className="size-7">
                    <Pause className="size-3.5" />
                  </IconButton>
                )}
                {(t.state === "paused" || (t.state === "error" && !t.fatal)) && (
                  <IconButton label={t.state === "error" ? "Retry" : "Resume"} onClick={() => uploader.resume(t.key)} className="size-7">
                    {t.state === "error" ? <RotateCw className="size-3.5" /> : <Play className="size-3.5" />}
                  </IconButton>
                )}
                {t.state !== "done" && (
                  <IconButton label="Cancel" onClick={() => uploader.cancel(t.key)} className="size-7">
                    <X className="size-3.5" />
                  </IconButton>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Full-window drop target. Also collects files from dropped folders. */
export function DropOverlay({ onFiles, target }: { onFiles: (files: File[]) => void; target: string }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const items = [...(e.dataTransfer?.items ?? [])];
      const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
      if (entries.some((en) => en.isDirectory)) onFiles(await collect(entries));
      else onFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [onFiles]);

  return (
    <AnimatePresence>
      {over && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center bg-ink-950/70 p-6 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            className="flex h-full max-h-[480px] w-full max-w-3xl flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-accent-400/60 bg-accent-500/[0.06] text-center"
          >
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 1.6, repeat: Infinity }} className="flex size-20 items-center justify-center rounded-3xl bg-accent-500/20 text-accent-300">
              <CloudUpload className="size-10" />
            </motion.div>
            <p className="mt-6 text-xl font-semibold">Drop to encrypt &amp; upload</p>
            <p className="mt-1.5 text-sm text-ink-300">into {target}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

async function collect(entries: FileSystemEntry[]): Promise<File[]> {
  const out: File[] = [];
  const walk = async (en: FileSystemEntry): Promise<void> => {
    if (en.isFile) {
      out.push(await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej)));
    } else if (en.isDirectory) {
      const reader = (en as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const b of batch) await walk(b);
      }
    }
  };
  for (const en of entries) await walk(en);
  return out.filter((f) => !f.name.startsWith("."));
}
