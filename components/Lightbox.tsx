"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderInput,
  Heart,
  Info,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/client/api";
import { formatBytes, formatDate, formatDuration } from "@/lib/client/format";
import { usePrefs } from "@/lib/client/prefs";
import type { AlbumDTO, ItemDTO } from "@/lib/types";
import { VideoPlayer } from "./VideoPlayer";
import { FloatingMenu, IconButton, Kbd, Portal, ProgressRing, cx } from "./ui";

const BROWSER_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

interface Props {
  items: ItemDTO[];
  index: number;
  albums: AlbumDTO[];
  onIndex: (i: number) => void;
  onClose: () => void;
  onFavorite: (item: ItemDTO) => void;
  onTrash: (item: ItemDTO) => void;
  onRestore?: (item: ItemDTO) => void;
  onRename: (item: ItemDTO, name: string) => void;
  onMove: (item: ItemDTO, albumId: string | null) => void;
  onNearEnd?: () => void;
}

export function Lightbox(props: Props) {
  const { items, index, onIndex, onClose } = props;
  const item = items[index];
  const [info, setInfo] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [slideshow, setSlideshow] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [dir, setDir] = useState(0);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null);
  const [prefs] = usePrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const go = useCallback(
    (d: number) => {
      const next = index + d;
      if (next < 0 || next >= items.length) return;
      setDir(d);
      onIndex(next);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    if (index >= items.length - 6) props.onNearEnd?.();
    // Preload neighbours so arrowing feels instant.
    for (const d of [1, -1, 2]) {
      const n = items[index + d];
      if (n?.kind === "image" && n.status === "ready") {
        const img = new Image();
        img.src = mediaUrl(n, n.has.preview ? "preview" : "original");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items]);

  // Slideshow timer (videos advance when they end).
  useEffect(() => {
    if (!slideshow || !item || item.kind === "video") return;
    const t = setTimeout(() => (index < items.length - 1 ? go(1) : setSlideshow(false)), prefs.slideshowSeconds * 1000);
    return () => clearTimeout(t);
  }, [slideshow, item, index, items.length, go, prefs.slideshowSeconds]);

  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setChrome(false), 3000);
  }, []);
  useEffect(() => {
    poke();
    return () => clearTimeout(idle.current);
  }, [poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape") {
        if (document.fullscreenElement) return;
        onClose();
      } else if (k === "ArrowRight" && !e.shiftKey) go(1);
      else if (k === "ArrowLeft" && !e.shiftKey) go(-1);
      else if (k === "Home") onIndex(0);
      else if (k === "End") onIndex(items.length - 1);
      else if (k === "i") setInfo((v) => !v);
      else if (k === "s") props.onFavorite(item);
      else if (k === "Delete" || k === "Backspace") props.onTrash(item);
      else if (k === "d") window.location.href = mediaUrl(item, "original", true);
      else if (item?.kind === "image" && (k === " " || k === "f")) {
        if (k === " ") setSlideshow((s) => !s);
        else if (document.fullscreenElement) document.exitFullscreen();
        else rootRef.current?.requestFullscreen().catch(() => {});
      } else return;
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, item, items.length, onClose, onIndex, poke, props]);

  // Lock page scroll behind the overlay.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!item) return null;
  const position = `${index + 1} / ${items.length}`;

  return (
    <Portal>
      <motion.div
        ref={rootRef}
        className="fixed inset-0 z-[70] flex bg-ink-950"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerMove={poke}
      >
        {/* ambient color wash from the photo's dominant color */}
        <div className="pointer-events-none absolute inset-0 opacity-40 transition-colors duration-700" style={{ background: `radial-gradient(70% 60% at 50% 50%, ${item.color ?? "#1a1a2e"}55, transparent 70%)` }} />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <div
            className={cx(
              "absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pt-[max(12px,env(safe-area-inset-top))] pb-8 transition-opacity duration-300 sm:px-5",
              chrome || item.kind === "video" ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <IconButton label="Close (Esc)" onClick={onClose}>
              <X className="size-5" />
            </IconButton>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="text-xs text-ink-400">
                {position} · {formatDate(item.takenAt ?? item.createdAt)}
              </p>
            </div>
            {item.kind === "image" && (
              <IconButton label={slideshow ? "Pause slideshow (space)" : "Slideshow (space)"} active={slideshow} onClick={() => setSlideshow((s) => !s)}>
                {slideshow ? <Pause className="size-[18px]" /> : <Play className="size-[18px]" />}
              </IconButton>
            )}
            <IconButton label="Favorite (s)" active={item.favorite} onClick={() => props.onFavorite(item)}>
              <Heart className={cx("size-[18px]", item.favorite && "fill-current")} />
            </IconButton>
            {!item.deletedAt && (
              <IconButton
                label="Move to album"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMoveMenu({ x: r.right - 208, y: r.bottom + 6 });
                }}
              >
                <FolderInput className="size-[18px]" />
              </IconButton>
            )}
            <a href={mediaUrl(item, "original", true)} aria-label="Download (d)" title="Download (d)" className="inline-flex size-9 items-center justify-center rounded-xl text-ink-300 hover:bg-white/[0.07] hover:text-white">
              <Download className="size-[18px]" />
            </a>
            {item.deletedAt ? (
              <IconButton label="Restore" onClick={() => props.onRestore?.(item)}>
                <RotateCcw className="size-[18px]" />
              </IconButton>
            ) : (
              <IconButton label="Move to trash (Del)" onClick={() => props.onTrash(item)}>
                <Trash2 className="size-[18px]" />
              </IconButton>
            )}
            <IconButton label="Info (i)" active={info} onClick={() => setInfo((v) => !v)} className="max-sm:hidden">
              <Info className="size-[18px]" />
            </IconButton>
            {item.kind === "image" && (
              <IconButton label="Fullscreen (f)" onClick={() => rootRef.current?.requestFullscreen().catch(() => {})} className="max-sm:hidden">
                <Maximize className="size-[18px]" />
              </IconButton>
            )}
          </div>

          {/* Stage */}
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              <motion.div
                key={item.id}
                custom={dir}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0, x: dir * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -60 }}
                transition={{ type: "spring", damping: 32, stiffness: 300 }}
              >
                {item.kind === "video" ? (
                  <VideoPlayer item={item} active onEnded={slideshow ? () => go(1) : undefined} />
                ) : (
                  <ZoomImage item={item} kenBurns={slideshow} onZoomChange={setZoomed} onSwipe={(d) => go(d)} />
                )}
              </motion.div>
            </AnimatePresence>

            {item.kind === "image" && item.status !== "ready" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
                  {item.status === "failed" ? item.error ?? "Processing failed" : (<><ProgressRing value={item.progress} size={28} /> Encrypting…</>)}
                </div>
              </div>
            )}

            {!zoomed && index > 0 && (
              <NavButton side="left" visible={chrome} onClick={() => go(-1)} />
            )}
            {!zoomed && index < items.length - 1 && (
              <NavButton side="right" visible={chrome} onClick={() => go(1)} />
            )}

            {slideshow && item.kind === "image" && (
              <motion.div
                key={`bar-${item.id}`}
                className="absolute inset-x-0 top-0 z-30 h-0.5 origin-left bg-gradient-to-r from-accent-500 to-cyan-400"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: prefs.slideshowSeconds, ease: "linear" }}
              />
            )}
          </div>

          {/* Filmstrip */}
          {item.kind === "image" && (
            <Filmstrip items={items} index={index} onIndex={(i) => (setDir(i > index ? 1 : -1), onIndex(i))} visible={chrome && !slideshow} />
          )}
        </div>

        <AnimatePresence>
          {info && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="relative z-30 hidden shrink-0 overflow-hidden border-l border-white/[0.06] bg-ink-900/90 backdrop-blur-xl sm:block"
            >
              <InfoPanel item={item} albums={props.albums} onRename={(n) => props.onRename(item, n)} onMove={(a) => props.onMove(item, a)} />
            </motion.aside>
          )}
        </AnimatePresence>

        <FloatingMenu
          at={moveMenu}
          onClose={() => setMoveMenu(null)}
          items={[
            { label: "Unsorted", checked: item.albumId === null, onSelect: () => props.onMove(item, null) },
            { separator: true, label: "" },
            ...props.albums.map((a) => ({ label: a.name, checked: a.id === item.albumId, onSelect: () => props.onMove(item, a.id) })),
          ]}
        />
      </motion.div>
    </Portal>
  );
}

function NavButton({ side, onClick, visible }: { side: "left" | "right"; onClick: () => void; visible: boolean }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous (←)" : "Next (→)"}
      className={cx(
        "absolute top-1/2 z-10 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white/15 sm:flex",
        side === "left" ? "left-4" : "right-4",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <Icon className="size-6" />
    </button>
  );
}

// ─── Zoomable image ──────────────────────────────────────────────────────────

function ZoomImage({ item, kenBurns, onZoomChange, onSwipe }: { item: ItemDTO; kenBurns: boolean; onZoomChange: (z: boolean) => void; onSwipe: (d: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [hiRes, setHiRes] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist: number; startS: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const displaySrc = mediaUrl(item, item.has.preview ? "preview" : "original");
  const canHiRes = item.has.preview && BROWSER_IMAGES.has(item.mime);
  const src = hiRes && canHiRes ? mediaUrl(item, "original") : displaySrc;

  useEffect(() => onZoomChange(t.s > 1.01), [t.s, onZoomChange]);
  useEffect(() => {
    if (t.s > 1.6 && canHiRes) setHiRes(true);
  }, [t.s, canHiRes]);

  const clamp = useCallback((s: number, x: number, y: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || s <= 1) return { s: Math.max(1, s), x: 0, y: 0 };
    const maxX = (r.width * (s - 1)) / 2;
    const maxY = (r.height * (s - 1)) / 2;
    return { s, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextS: number) => {
      const r = box.current!.getBoundingClientRect();
      const cx0 = clientX - r.left - r.width / 2;
      const cy0 = clientY - r.top - r.height / 2;
      setT((p) => {
        const s = Math.max(1, Math.min(8, nextS));
        const k = s / p.s;
        return clamp(s, cx0 - (cx0 - p.x) * k, cy0 - (cy0 - p.y) * k);
      });
    },
    [clamp],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setT((p) => {
        const s = Math.max(1, Math.min(8, p.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))));
        const r = el.getBoundingClientRect();
        const cx0 = e.clientX - r.left - r.width / 2;
        const cy0 = e.clientY - r.top - r.height / 2;
        const k = s / p.s;
        return clamp(s, cx0 - (cx0 - p.x) * k, cy0 - (cy0 - p.y) * k);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp]);

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      startDist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      startS: t.s,
      startX: e.clientX,
      startY: e.clientY,
      panX: t.x,
      panY: t.y,
      moved: false,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.startDist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, g.startS * (d / g.startDist));
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (t.s > 1) setT(clamp(t.s, g.panX + dx, g.panY + dy));
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (t.s <= 1.01 && pointers.current.size === 0 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    if (!g.moved && pointers.current.size === 0) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        if (t.s > 1) setT({ s: 1, x: 0, y: 0 });
        else zoomAt(e.clientX, e.clientY, 2.5);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  return (
    <div
      ref={box}
      className={cx("relative flex size-full touch-none items-center justify-center", t.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {!loaded && item.has.thumb && (
        <img src={mediaUrl(item, "thumb")} alt="" className="absolute max-h-full max-w-full scale-105 object-contain blur-xl" draggable={false} />
      )}
      <div className={cx("flex size-full items-center justify-center", kenBurns && "kenburns")}>
        <img
          src={src}
          alt={item.name}
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cx("max-h-full max-w-full object-contain transition-opacity duration-300 will-change-transform", loaded ? "opacity-100" : "opacity-0")}
          style={{ transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`, transition: pointers.current.size ? "none" : "transform 0.18s ease-out, opacity .3s" }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      {t.s > 1.01 && (
        <button
          onClick={() => setT({ s: 1, x: 0, y: 0 })}
          className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs backdrop-blur-md"
        >
          <ZoomIn className="size-3.5" /> {Math.round(t.s * 100)}% · reset
        </button>
      )}
    </div>
  );
}

// ─── Filmstrip ───────────────────────────────────────────────────────────────

const Filmstrip = memo(function Filmstrip({ items, index, onIndex, visible }: { items: ItemDTO[]; index: number; onIndex: (i: number) => void; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const from = Math.max(0, index - 40);
  const slice = items.slice(from, index + 41);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);
  return (
    <div className={cx("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-[max(12px,env(safe-area-inset-bottom))] transition-opacity duration-300", visible ? "opacity-100" : "pointer-events-none opacity-0")}>
      <div ref={ref} className="no-scrollbar mx-auto flex max-w-4xl gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        {slice.map((it, i) => {
          const idx = from + i;
          const cur = idx === index;
          return (
            <button
              key={it.id}
              data-current={cur || undefined}
              onClick={() => onIndex(idx)}
              className={cx("relative h-14 shrink-0 overflow-hidden rounded-lg transition-all", cur ? "w-20 ring-2 ring-white" : "w-10 opacity-50 hover:opacity-90")}
              style={{ background: it.color ?? "#222" }}
            >
              {it.has.thumb && <img src={mediaUrl(it, "thumb")} alt="" loading="lazy" className="size-full object-cover" draggable={false} />}
            </button>
          );
        })}
      </div>
    </div>
  );
});

// ─── Info panel ──────────────────────────────────────────────────────────────

function InfoPanel({ item, albums, onRename, onMove }: { item: ItemDTO; albums: AlbumDTO[]; onRename: (n: string) => void; onMove: (a: string | null) => void }) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.id, item.name]);
  const rows: [string, string][] = [
    ["Type", item.mime.replace(/^\w+\//, "").toUpperCase()],
    ["Size", formatBytes(item.size)],
  ];
  if (item.width && item.height) rows.push(["Dimensions", `${item.width} × ${item.height}${item.width * item.height > 1e6 ? ` · ${((item.width * item.height) / 1e6).toFixed(1)} MP` : ""}`]);
  if (item.duration) rows.push(["Duration", formatDuration(item.duration)]);
  rows.push(["Taken", formatDate(item.takenAt, true)], ["Added", formatDate(item.createdAt, true)]);
  if (item.has.playback) rows.push(["Playback", "Optimized H.264 copy"]);
  if (item.storyboard) rows.push(["Scrub previews", `${item.storyboard.count} frames`]);

  return (
    <div className="w-80 space-y-6 p-5 pt-20">
      <div>
        <label className="text-[11px] font-medium tracking-wider text-ink-500 uppercase">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== item.name && onRename(name.trim())}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-accent-500/60"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium tracking-wider text-ink-500 uppercase">Album</label>
        <select
          value={item.albumId ?? ""}
          onChange={(e) => onMove(e.target.value || null)}
          disabled={!!item.deletedAt}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-accent-500/60"
        >
          <option value="">Unsorted</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <dl className="space-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-ink-400">{k}</dt>
            <dd className="text-right text-ink-100">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3.5 text-xs leading-relaxed text-ink-400">
        Stored encrypted (AES-256-GCM). Thumbnails and previews are re-encoded copies with all metadata stripped.
      </div>
      <div className="space-y-1.5 text-xs text-ink-500">
        <p className="flex justify-between"><span>Next / previous</span><span><Kbd>←</Kbd> <Kbd>→</Kbd></span></p>
        <p className="flex justify-between"><span>Favorite · Download · Trash</span><span><Kbd>S</Kbd> <Kbd>D</Kbd> <Kbd>Del</Kbd></span></p>
        <p className="flex justify-between"><span>Slideshow · Fullscreen</span><span><Kbd>Space</Kbd> <Kbd>F</Kbd></span></p>
      </div>
    </div>
  );
}
