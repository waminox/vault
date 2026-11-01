"use client";

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { motion } from "motion/react";
import { FolderOpen, Heart, Images, Inbox, LayoutGrid, MoreHorizontal, Plus, Trash2, Video } from "lucide-react";
import { mediaUrl } from "@/lib/client/api";
import { formatBytes } from "@/lib/client/format";
import type { AlbumDTO, Stats, View } from "@/lib/types";
import { MenuButton, type MenuItem, cx } from "./ui";

export interface Location {
  view: View;
  albumId?: string;
}

interface Props {
  location: Location;
  albums: AlbumDTO[];
  stats: Stats | null;
  dragging: "item" | "album" | null;
  onNavigate: (l: Location) => void;
  onNewAlbum: () => void;
  albumMenu: (a: AlbumDTO) => MenuItem[];
}

const NAV: { view: View; label: string; icon: typeof Images; stat?: keyof Stats }[] = [
  { view: "all", label: "Library", icon: LayoutGrid },
  { view: "photos", label: "Photos", icon: Images, stat: "photos" },
  { view: "videos", label: "Videos", icon: Video, stat: "videos" },
  { view: "favorites", label: "Favorites", icon: Heart, stat: "favorites" },
  { view: "unsorted", label: "Unsorted", icon: Inbox, stat: "unsorted" },
];

export function Sidebar({ location, albums, stats, dragging, onNavigate, onNewAlbum, albumMenu }: Props) {
  const isActive = (l: Location) => l.view === location.view && (l.view !== "album" || l.albumId === location.albumId);
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 pt-5 pb-4" aria-label="Library">
      <div className="flex items-center gap-2.5 px-2">
        <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg`} alt="" className="size-7" />
        <span className="text-[15px] font-semibold tracking-tight">Vault</span>
      </div>

      <div className="space-y-0.5">
        {NAV.map((n) => (
          <NavRow
            key={n.view}
            active={isActive({ view: n.view })}
            onClick={() => onNavigate({ view: n.view })}
            icon={<n.icon className="size-4" />}
            label={n.label}
            count={n.stat && stats ? stats[n.stat] : undefined}
            dropId={n.view === "unsorted" ? "album:__unsorted" : undefined}
            dropActive={dragging === "item"}
          />
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Albums</span>
          <button onClick={onNewAlbum} aria-label="New album" title="New album (N)" className="flex size-6 items-center justify-center rounded-md text-ink-400 hover:bg-white/[0.07] hover:text-white">
            <Plus className="size-4" />
          </button>
        </div>
        <SortableContext items={albums.map((a) => `album:${a.id}`)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {albums.map((a) => (
              <AlbumRow key={a.id} album={a} active={isActive({ view: "album", albumId: a.id })} onClick={() => onNavigate({ view: "album", albumId: a.id })} menu={() => albumMenu(a)} dropActive={dragging === "item"} />
            ))}
          </div>
        </SortableContext>
        {!albums.length && (
          <button onClick={onNewAlbum} className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-ink-500 hover:border-accent-500/40 hover:text-ink-300">
            Create your first album
          </button>
        )}
      </div>

      <div className="mt-auto space-y-0.5">
        <NavRow active={isActive({ view: "trash" })} onClick={() => onNavigate({ view: "trash" })} icon={<Trash2 className="size-4" />} label="Trash" count={stats?.trash} />
        {stats && (
          <div className="mx-2 mt-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3">
            <div className="flex justify-between text-[11px] text-ink-400">
              <span>Encrypted storage</span>
              <span className="text-ink-200">{formatBytes(stats.storedBytes)}</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400" style={{ width: `${Math.min(100, (stats.bytes / Math.max(stats.storedBytes, 1)) * 100)}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              {stats.photos.toLocaleString()} photos · {stats.videos.toLocaleString()} videos
              {stats.processing > 0 && <span className="text-accent-400"> · {stats.processing} processing</span>}
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}

function NavRow({
  active,
  onClick,
  icon,
  label,
  count,
  dropId,
  dropActive,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  dropId?: string;
  dropActive?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `nav:${label}`, disabled: !dropId, data: { type: "album", id: null } });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cx(
        "relative flex h-9 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[13px] transition-colors",
        active ? "text-white" : "text-ink-300 hover:bg-white/[0.04] hover:text-white",
        isOver && "bg-accent-500/25 text-white ring-1 ring-accent-500",
        dropId && dropActive && !isOver && "ring-1 ring-white/10 ring-dashed",
      )}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-white/[0.08]" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
      <span className="relative text-ink-400">{icon}</span>
      <span className="relative flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="relative text-[11px] text-ink-500 tabular-nums">{count.toLocaleString()}</span>}
    </button>
  );
}

function AlbumRow({ album, active, onClick, menu, dropActive }: { album: AlbumDTO; active: boolean; onClick: () => void; menu: () => MenuItem[]; dropActive: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active: dragActive } = useSortable({
    id: `album:${album.id}`,
    data: { type: "album", id: album.id },
  });
  const itemOver = isOver && dragActive?.data.current?.type === "item";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx("group relative", isDragging && "z-10 opacity-60")}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={cx(
          "relative flex h-11 w-full items-center gap-3 rounded-xl pr-8 pl-1.5 text-left text-[13px] transition-colors",
          active ? "text-white" : "text-ink-300 hover:bg-white/[0.04] hover:text-white",
          itemOver && "scale-[1.02] bg-accent-500/25 text-white ring-1 ring-accent-500",
          dropActive && !itemOver && "ring-1 ring-white/[0.07]",
        )}
      >
        {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-white/[0.08]" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
        <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-700">
          {album.coverId ? (
            <img src={mediaUrl({ id: album.coverId, rev: album.coverRev ?? 0 }, "thumb")} alt="" className="tile-media size-full object-cover" draggable={false} />
          ) : (
            <FolderOpen className="size-4 text-ink-400" />
          )}
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block truncate">{album.name}</span>
          <span className="block text-[11px] text-ink-500">{album.count.toLocaleString()} items</span>
        </span>
      </button>
      <MenuButton
        label={`${album.name} options`}
        items={menu}
        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] hover:text-white focus:opacity-100 max-md:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </MenuButton>
    </div>
  );
}
