"use client";

import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, FolderOpen, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, mediaUrl } from "@/lib/client/api";
import type { AlbumDTO, ItemDTO } from "@/lib/types";
import { Kbd, Portal, cx } from "./ui";

export interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  run: () => void;
  keywords?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  albums: AlbumDTO[];
  onAlbum: (a: AlbumDTO) => void;
  onItem: (items: ItemDTO[], index: number) => void;
}

type Row = { kind: "cmd"; cmd: Command } | { kind: "album"; album: AlbumDTO } | { kind: "item"; item: ItemDTO; list: ItemDTO[]; index: number };

export function CommandPalette({ open, onClose, commands, albums, onAlbum, onItem }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState<ItemDTO[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setFound([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) return setFound([]);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<{ items: ItemDTO[] }>(`/api/items?view=all&sort=added&dir=desc&limit=12&q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => setFound(r.items))
        .catch(() => {});
    }, 160);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    return [
      ...commands.filter((c) => match(`${c.label} ${c.keywords ?? ""}`)).map((cmd) => ({ kind: "cmd" as const, cmd })),
      ...albums.filter((a) => needle && match(a.name)).map((album) => ({ kind: "album" as const, album })),
      ...found.map((item, index) => ({ kind: "item" as const, item, list: found, index })),
    ];
  }, [q, commands, albums, found]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, rows.length - 1))), [rows.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    if (r.kind === "cmd") r.cmd.run();
    else if (r.kind === "album") onAlbum(r.album);
    else onItem(r.list, r.index);
  };

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <motion.div
              initial={{ y: -12, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: -8, scale: 0.98 }}
              transition={{ type: "spring", damping: 30, stiffness: 420 }}
              className="glass relative w-full max-w-xl overflow-hidden rounded-3xl shadow-2xl shadow-black/60"
              role="dialog"
              aria-label="Command palette"
            >
              <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
                <Search className="size-4 text-ink-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => (setQ(e.target.value), setSel(0))}
                  placeholder="Search photos, videos, albums or actions…"
                  className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-500"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(rows.length - 1, s + 1)));
                    else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
                    else if (e.key === "Enter") (e.preventDefault(), run(rows[sel]));
                    else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), onClose());
                  }}
                />
                <Kbd>Esc</Kbd>
              </div>
              <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
                {!rows.length && <p className="px-3 py-8 text-center text-sm text-ink-500">Nothing matches “{q}”</p>}
                {rows.map((r, i) => {
                  const showHeader = i === 0 || rows[i - 1].kind !== r.kind;
                  return (
                    <div key={r.kind === "cmd" ? r.cmd.id : r.kind === "album" ? r.album.id : r.item.id}>
                      {showHeader && (
                        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                          {r.kind === "cmd" ? "Actions" : r.kind === "album" ? "Albums" : "Media"}
                        </p>
                      )}
                      <button
                        data-idx={i}
                        onMouseMove={() => setSel(i)}
                        onClick={() => run(r)}
                        className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm", sel === i ? "bg-white/[0.08]" : "")}
                      >
                        {r.kind === "cmd" && (
                          <>
                            <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.05] text-ink-300">{r.cmd.icon}</span>
                            <span className="flex-1">{r.cmd.label}</span>
                            {r.cmd.hint && <Kbd>{r.cmd.hint}</Kbd>}
                          </>
                        )}
                        {r.kind === "album" && (
                          <>
                            <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-white/[0.05]">
                              {r.album.coverId ? <img src={mediaUrl({ id: r.album.coverId, rev: r.album.coverRev ?? 0 }, "thumb")} alt="" className="tile-media size-full object-cover" /> : <FolderOpen className="size-4 text-ink-300" />}
                            </span>
                            <span className="flex-1">{r.album.name}</span>
                            <span className="text-xs text-ink-500">{r.album.count} items</span>
                          </>
                        )}
                        {r.kind === "item" && (
                          <>
                            <span className="size-8 overflow-hidden rounded-lg bg-white/[0.05]" style={{ background: r.item.color ?? undefined }}>
                              {r.item.has.thumb && <img src={mediaUrl(r.item, "thumb")} alt="" className="tile-media size-full object-cover" />}
                            </span>
                            <span className="flex-1 truncate">{r.item.name}</span>
                            <span className="text-xs text-ink-500">{r.item.kind}</span>
                          </>
                        )}
                        {sel === i && <CornerDownLeft className="size-3.5 text-ink-500" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
