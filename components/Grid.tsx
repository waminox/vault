"use client";

import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Check, Heart, Play, RotateCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/client/api";
import { formatDuration } from "@/lib/client/format";
import type { ItemDTO } from "@/lib/types";
import { ProgressRing, cx } from "./ui";

interface GridProps {
  items: ItemDTO[];
  selected: Set<string>;
  selectMode: boolean;
  canReorder: boolean;
  draggable: boolean;
  hoverPreview: boolean;
  blurred: boolean;
  onOpen: (index: number) => void;
  onSelect: (id: string, mode: "toggle" | "range" | "only") => void;
  onContext: (item: ItemDTO, at: { x: number; y: number }) => void;
  onFavorite: (item: ItemDTO) => void;
  onRetry: (item: ItemDTO) => void;
  onEndReached: () => void;
  hasMore: boolean;
  draggingIds: Set<string>;
}

const noMotion = () => null;

export function Grid(p: GridProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !p.hasMore) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && p.onEndReached(), { rootMargin: "1200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.hasMore, p.onEndReached, p]);

  return (
    <SortableContext items={p.items.map((i) => `item:${i.id}`)} strategy={p.canReorder ? rectSortingStrategy : noMotion}>
      <div className="grid-tiles" role="grid" aria-label="Media">
        {p.items.map((item, i) => (
          <Tile
            key={item.id}
            item={item}
            index={i}
            selected={p.selected.has(item.id)}
            selectMode={p.selectMode}
            draggable={p.draggable}
            ghost={p.draggingIds.has(item.id)}
            hoverPreview={p.hoverPreview && !p.blurred}
            onOpen={p.onOpen}
            onSelect={p.onSelect}
            onContext={p.onContext}
            onFavorite={p.onFavorite}
            onRetry={p.onRetry}
          />
        ))}
      </div>
      <div ref={sentinel} className="h-px" />
    </SortableContext>
  );
}

interface TileProps {
  item: ItemDTO;
  index: number;
  selected: boolean;
  selectMode: boolean;
  draggable: boolean;
  ghost: boolean;
  hoverPreview: boolean;
  onOpen: (index: number) => void;
  onSelect: GridProps["onSelect"];
  onContext: GridProps["onContext"];
  onFavorite: GridProps["onFavorite"];
  onRetry: GridProps["onRetry"];
}

const Tile = memo(function Tile({ item, index, selected, selectMode, draggable, ghost, hoverPreview, onOpen, onSelect, onContext, onFavorite, onRetry }: TileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item:${item.id}`,
    data: { type: "item", id: item.id },
    disabled: !draggable,
  });
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ready = item.status === "ready";
  const playable = item.kind === "video" && ready && (item.has.playback || ["video/mp4", "video/webm", "video/quicktime"].includes(item.mime));

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    background: item.color ? `${item.color}` : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="gridcell"
      aria-selected={selected}
      aria-label={item.name}
      tabIndex={0}
      className={cx(
        "tile group relative aspect-square cursor-pointer overflow-hidden rounded-xl bg-ink-800 outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        (isDragging || ghost) && "opacity-30",
        selected && "ring-[3px] ring-accent-500 ring-offset-2 ring-offset-ink-950",
      )}
      onClick={(e) => {
        if (e.shiftKey) onSelect(item.id, "range");
        else if (e.metaKey || e.ctrlKey || selectMode) onSelect(item.id, "toggle");
        else onOpen(index);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(index);
        else if (e.key === " " && !e.repeat) {
          e.preventDefault();
          onSelect(item.id, "toggle");
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(item, { x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => {
        if (!playable || !hoverPreview) return;
        hoverTimer.current = setTimeout(() => setPreview(true), 380);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer.current);
        setPreview(false);
      }}
    >
      {item.has.thumb ? (
        <img
          src={mediaUrl(item, "thumb")}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cx("tile-media size-full object-cover transition duration-500 group-hover:scale-[1.04]", loaded ? "opacity-100" : "opacity-0", selected && "scale-[0.92] rounded-lg")}
        />
      ) : (
        <div className="shimmer size-full" />
      )}

      {preview && (
        <video
          src={`${mediaUrl(item, "stream")}#t=${Math.min(10, (item.duration ?? 0) * 0.15).toFixed(1)}`}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          className="tile-media pointer-events-none absolute inset-0 size-full object-cover"
        />
      )}

      {/* overlays */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/25 opacity-0 transition-opacity group-hover:opacity-100" />

      {item.kind === "video" && ready && (
        <div className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <Play className="size-2.5 fill-white" />
          {formatDuration(item.duration)}
        </div>
      )}

      {item.favorite && !selectMode && (
        <Heart className="pointer-events-none absolute bottom-1.5 left-1.5 size-4 fill-rose-400 text-rose-400 drop-shadow" />
      )}

      {/* selection check */}
      <button
        aria-label={selected ? "Deselect" : "Select"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(item.id, e.shiftKey ? "range" : "toggle");
        }}
        className={cx(
          "absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 transition-all",
          selected ? "border-accent-500 bg-accent-500 opacity-100" : "border-white/80 bg-black/20 opacity-0 group-hover:opacity-100",
          selectMode && "opacity-100",
        )}
      >
        {selected && <Check className="size-3.5 text-white" strokeWidth={3} />}
      </button>

      {!selectMode && ready && (
        <button
          aria-label={item.favorite ? "Unfavorite" : "Favorite"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite(item);
          }}
          className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/30 opacity-0 backdrop-blur-sm transition group-hover:opacity-100 hover:scale-110"
        >
          <Heart className={cx("size-3.5", item.favorite ? "fill-rose-400 text-rose-400" : "text-white")} />
        </button>
      )}

      {item.status === "processing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45 backdrop-blur-[2px]">
          <ProgressRing value={item.progress} size={36} />
          <span className="text-[11px] font-medium text-white/90">
            {item.has.original && item.kind === "video" ? "Converting" : "Encrypting"}
            {item.progress != null && item.progress > 0.02 ? ` ${Math.round(item.progress * 100)}%` : "…"}
          </span>
        </div>
      )}
      {item.status === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-950/70 p-2 text-center">
          <AlertTriangle className="size-5 text-red-300" />
          <span className="line-clamp-2 text-[11px] text-red-100">{item.error ?? "Processing failed"}</span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRetry(item);
            }}
            className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] hover:bg-white/25"
          >
            <RotateCw className="size-3" /> Retry
          </button>
        </div>
      )}
      {ready && item.error && item.kind === "video" && (
        <span title={item.error} className="pointer-events-none absolute top-1.5 right-1.5 rounded-md bg-amber-500/80 px-1 text-[10px] font-semibold text-black group-hover:hidden">
          !
        </span>
      )}
    </div>
  );
});

export function TileOverlay({ item, count }: { item: ItemDTO; count: number }) {
  return (
    <div className="relative size-28 rotate-3 cursor-grabbing">
      {count > 1 && <div className="absolute inset-0 translate-x-2 translate-y-2 rotate-6 rounded-xl bg-ink-600 shadow-xl" />}
      <div className="relative size-full overflow-hidden rounded-xl bg-ink-700 shadow-2xl ring-2 ring-accent-500" style={{ background: item.color ?? undefined }}>
        {item.has.thumb && <img src={mediaUrl(item, "thumb")} alt="" className="size-full object-cover" draggable={false} />}
      </div>
      {count > 1 && (
        <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-accent-500 text-xs font-bold text-white shadow-lg">{count}</span>
      )}
    </div>
  );
}
