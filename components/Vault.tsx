"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownUp,
  CheckSquare,
  Command as CommandIcon,
  Download,
  Eye,
  EyeOff,
  FolderInput,
  FolderPlus,
  Heart,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Menu,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BASE, api, mediaUrl, onSessionLost } from "@/lib/client/api";
import { lsGet, lsSet, usePrefs } from "@/lib/client/prefs";
import { Uploader } from "@/lib/client/uploader";
import type { AlbumDTO, ItemDTO, SortKey, Stats } from "@/lib/types";
import { CommandPalette, type Command } from "./CommandPalette";
import { Grid, TileOverlay } from "./Grid";
import { Lightbox } from "./Lightbox";
import { Settings } from "./Settings";
import { Sidebar, type Location } from "./Sidebar";
import { DropOverlay, UploadTray } from "./Uploads";
import { AskProvider, Button, Dialog, FloatingMenu, IconButton, Kbd, MenuButton, Segmented, cx, useAsk, type MenuItem } from "./ui";

const PAGE = 200;

const VIEW_LABEL: Record<string, string> = {
  all: "Library",
  photos: "Photos",
  videos: "Videos",
  favorites: "Favorites",
  unsorted: "Unsorted",
  trash: "Trash",
};

const SORT_LABEL: Record<SortKey, string> = {
  manual: "Custom order",
  added: "Date added",
  taken: "Date taken",
  name: "Name",
  size: "File size",
  duration: "Duration",
};

type Sort = { key: SortKey; dir: "asc" | "desc" };

function readLocation(): Location {
  if (typeof window === "undefined") return { view: "all" };
  const sp = new URLSearchParams(window.location.search);
  const album = sp.get("album");
  if (album) return { view: "album", albumId: album };
  const view = sp.get("view") as Location["view"] | null;
  return view && view in VIEW_LABEL ? { view } : { view: "all" };
}

function locKey(l: Location) {
  return l.view === "album" ? `album:${l.albumId}` : l.view;
}

function defaultSort(l: Location): Sort {
  return lsGet<Sort>(`vault:sort:${locKey(l)}`, l.view === "album" || l.view === "unsorted" ? { key: "manual", dir: "asc" } : { key: "added", dir: "desc" });
}

function compare(a: ItemDTO, b: ItemDTO, s: Sort): number {
  const d = s.dir === "asc" ? 1 : -1;
  switch (s.key) {
    case "manual":
      return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
    case "added":
      return d * (a.createdAt - b.createdAt);
    case "taken":
      return d * ((a.takenAt ?? a.createdAt) - (b.takenAt ?? b.createdAt));
    case "name":
      return d * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    case "size":
      return d * (a.size - b.size);
    case "duration":
      return d * ((a.duration ?? -1) - (b.duration ?? -1));
  }
}

function matches(it: ItemDTO, l: Location, kind: string, q: string): boolean {
  if (l.view === "trash") {
    if (!it.deletedAt) return false;
  } else if (it.deletedAt) return false;
  if (l.view === "album" && it.albumId !== l.albumId) return false;
  if (l.view === "unsorted" && it.albumId !== null) return false;
  if (l.view === "photos" && it.kind !== "image") return false;
  if (l.view === "videos" && it.kind !== "video") return false;
  if (l.view === "favorites" && !it.favorite) return false;
  if (kind !== "all" && it.kind !== kind) return false;
  if (q && !it.name.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

export function Vault() {
  return (
    <AskProvider>
      <VaultApp />
    </AskProvider>
  );
}

function VaultApp() {
  const ask = useAsk();
  const [prefs, setPrefs] = usePrefs();
  const [loc, setLoc] = useState<Location>({ view: "all" });
  const [sort, setSort] = useState<Sort>({ key: "added", dir: "desc" });
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [albums, setAlbums] = useState<AlbumDTO[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [lightbox, setLightbox] = useState<{ id: string; list: ItemDTO[] | null } | null>(null);
  const [blurred, setBlurred] = useState(true);
  const [shield, setShield] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [ctx, setCtx] = useState<{ item: ItemDTO; at: { x: number; y: number } } | null>(null);
  const [drag, setDrag] = useState<{ type: "item" | "album"; ids: string[]; item?: ItemDTO } | null>(null);
  const [ready, setReady] = useState(false);
  const uploader = useMemo(() => new Uploader(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const totalRef = useRef(total);
  totalRef.current = total;
  const anchor = useRef<string | null>(null);
  const reqId = useRef(0);
  const ctxRef = useRef({ loc, sort, kind, q: debouncedQuery });
  ctxRef.current = { loc, sort, kind, q: debouncedQuery };

  const album = loc.view === "album" ? albums.find((a) => a.id === loc.albumId) : undefined;
  const title = loc.view === "album" ? album?.name ?? "Album" : VIEW_LABEL[loc.view];
  const canReorder = (loc.view === "album" || loc.view === "unsorted") && sort.key === "manual" && kind === "all" && !debouncedQuery;
  const uploadTarget = loc.view === "album" ? loc.albumId! : null;

  // ─── Boot ───
  useEffect(() => {
    const l = readLocation();
    setLoc(l);
    setSort(defaultSort(l));
    setBlurred(prefs.blurOnLoad);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lock = useCallback(async (leave = false) => {
    document.documentElement.classList.add("shielded");
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "same-origin", keepalive: true });
    } catch {}
    window.location.replace(leave ? "about:blank" : `${BASE}/login`);
  }, []);

  useEffect(() => onSessionLost(() => window.location.replace(`${BASE}/login`)), []);

  // ─── Data ───
  const refreshMeta = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api<{ albums: AlbumDTO[] }>("/api/albums"), api<{ stats: Stats }>("/api/stats")]);
      setAlbums(a.albums);
      setStats(s.stats);
    } catch {}
  }, []);

  const load = useCallback(async (reset: boolean) => {
    const { loc: l, sort: s, kind: k, q } = ctxRef.current;
    const id = ++reqId.current;
    const params = new URLSearchParams({ view: l.view, sort: s.key, dir: s.dir, offset: String(reset ? 0 : itemsRef.current.length), limit: String(PAGE) });
    if (l.albumId) params.set("albumId", l.albumId);
    if (k !== "all") params.set("kind", k);
    if (q) params.set("q", q);
    if (reset) setLoading(true);
    try {
      const r = await api<{ items: ItemDTO[]; total: number }>(`/api/items?${params}`);
      if (id !== reqId.current) return;
      setItems((prev) => {
        if (reset) return r.items;
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...r.items.filter((i) => !seen.has(i.id))];
      });
      setTotal(r.total);
    } catch {
      if (id === reqId.current) toast.error("Couldn't load your library");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    load(true);
    setSelected(new Set());
  }, [ready, loc, sort, kind, debouncedQuery, load]);

  useEffect(() => {
    if (ready) refreshMeta();
  }, [ready, refreshMeta]);

  // Keep URL in sync (shareable / reload-safe, no server round trip).
  useEffect(() => {
    if (!ready) return;
    const url = loc.view === "album" ? `?album=${loc.albumId}` : loc.view === "all" ? window.location.pathname : `?view=${loc.view}`;
    window.history.replaceState(null, "", url);
  }, [loc, ready]);

  // ─── Live updates ───
  useEffect(() => {
    if (!ready) return;
    let es: EventSource | null = null;
    let metaTimer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const meta = () => {
      clearTimeout(metaTimer);
      metaTimer = setTimeout(refreshMeta, 250);
    };
    const connect = () => {
      es = new EventSource(`${BASE}/api/events`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data);
        const { loc: l, sort: s, kind: k, q } = ctxRef.current;
        if (e.type === "items") {
          setItems((prev) => {
            let next = prev;
            for (const dto of e.items as ItemDTO[]) {
              const i = next.findIndex((x) => x.id === dto.id);
              const fits = matches(dto, l, k, q);
              if (i >= 0) {
                if (!fits) next = next.filter((x) => x.id !== dto.id);
                else if (s.key === "manual" && next[i].position !== dto.position) {
                  const rest = next.filter((x) => x.id !== dto.id);
                  const at = rest.findIndex((x) => compare(dto, x, s) < 0);
                  next = at < 0 ? [...rest, dto] : [...rest.slice(0, at), dto, ...rest.slice(at)];
                } else next = next.map((x) => (x.id === dto.id ? dto : x));
              } else if (fits) {
                const at = next.findIndex((x) => compare(dto, x, s) < 0);
                if (at < 0 && next.length < totalRef.current) continue; // belongs beyond what we've loaded
                next = at < 0 ? [...next, dto] : [...next.slice(0, at), dto, ...next.slice(at)];
                setTotal((t) => t + 1);
              }
            }
            return next;
          });
          meta();
        } else if (e.type === "item.removed") {
          const gone = new Set<string>(e.ids);
          setItems((prev) => {
            const next = prev.filter((x) => !gone.has(x.id));
            if (next.length !== prev.length) setTotal((t) => Math.max(0, t - (prev.length - next.length)));
            return next;
          });
          setSelected((sel) => new Set([...sel].filter((id) => !gone.has(id))));
        } else if (e.type === "item.progress") {
          setItems((prev) => prev.map((x) => (x.id === e.id ? { ...x, progress: e.progress } : x)));
        } else if (e.type === "albums.changed") meta();
        else if (e.type === "item.duplicate") toast(`Skipped “${e.name}”`, { description: "An identical file is already in your vault." });
        else if (e.type === "vault.sealed" || e.type === "session.ended") window.location.replace(`${BASE}/login`);
      };
      es.onerror = () => {
        es?.close();
        api<{ signedIn: boolean }>("/api/auth/status")
          .then((s) => (s.signedIn ? (retry = setTimeout(connect, 3000)) : window.location.replace(`${BASE}/login`)))
          .catch(() => (retry = setTimeout(connect, 5000)));
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(metaTimer);
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, refreshMeta]);

  // ─── Privacy: shield, idle lock, panic ───
  useEffect(() => {
    if (!prefs.shieldOnBlur) return;
    const on = () => {
      document.documentElement.classList.add("shielded"); // synchronous: beats task-switcher snapshots
      setShield(true);
    };
    const vis = () => document.visibilityState === "hidden" && on();
    window.addEventListener("blur", on);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("blur", on);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [prefs.shieldOnBlur]);

  const unshield = useCallback(() => {
    document.documentElement.classList.remove("shielded");
    setShield(false);
  }, []);

  useEffect(() => {
    if (!prefs.autoLockMinutes) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const evs = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (uploader.active().length) return bump(); // never lock mid-upload
      if (Date.now() - last > prefs.autoLockMinutes * 60_000) lock();
    }, 10_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [prefs.autoLockMinutes, lock, uploader]);

  // ─── Actions ───
  const act = useCallback(async (body: Record<string, unknown>, okMsg?: string) => {
    try {
      await api("/api/items/actions", { method: "POST", json: body });
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error((e as Error).message);
      load(true);
    }
  }, [load]);

  const selectedIds = useCallback(() => items.filter((i) => selected.has(i.id)).map((i) => i.id), [items, selected]);

  const toggleFavorite = useCallback(
    (ids: string[], value: boolean) => {
      setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, favorite: value } : i)));
      act({ action: "favorite", ids, value });
    },
    [act],
  );

  const trash = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      await act({ action: "trash", ids });
      toast(`Moved ${ids.length === 1 ? "1 item" : `${ids.length} items`} to trash`, {
        action: { label: "Undo", onClick: () => act({ action: "restore", ids }) },
      });
    },
    [act],
  );

  const restore = useCallback(
    (ids: string[]) => {
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      act({ action: "restore", ids }, `Restored ${ids.length === 1 ? "1 item" : `${ids.length} items`}`);
    },
    [act],
  );

  const purge = useCallback(
    async (ids: string[]) => {
      const ok = await ask({ title: `Delete ${ids.length === 1 ? "this item" : `${ids.length} items`} forever?`, body: "The encrypted files are shredded. This can't be undone.", confirm: "Delete forever", danger: true });
      if (!ok) return;
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      act({ action: "purge", ids });
    },
    [act, ask],
  );

  const moveTo = useCallback(
    (ids: string[], albumId: string | null) => {
      const name = albumId ? albums.find((a) => a.id === albumId)?.name : "Unsorted";
      if (loc.view === "album" || loc.view === "unsorted") setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      act({ action: "move", ids, albumId }, `Moved ${ids.length === 1 ? "1 item" : `${ids.length} items`} to ${name}`);
    },
    [act, albums, loc.view],
  );

  const rename = useCallback(async (item: ItemDTO, name?: string) => {
    const next = name ?? (await ask({ title: "Rename", input: { initial: item.name }, confirm: "Rename" }));
    if (!next || next === item.name) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name: next } : i)));
    try {
      await api(`/api/items/${item.id}`, { method: "PATCH", json: { name: next } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [ask]);

  const downloadMany = useCallback((list: ItemDTO[]) => {
    list.forEach((it, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = mediaUrl(it, "original", true);
        a.download = it.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 350),
    );
  }, []);

  const newAlbum = useCallback(async () => {
    const name = await ask({ title: "New album", input: { placeholder: "Album name" }, confirm: "Create" });
    if (!name) return;
    try {
      const { album: a } = await api<{ album: AlbumDTO }>("/api/albums", { method: "POST", json: { name } });
      setAlbums((prev) => [...prev, a]);
      const ids = selectedIds();
      if (ids.length) moveTo(ids, a.id);
      else setLoc({ view: "album", albumId: a.id });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [ask, moveTo, selectedIds]);

  const albumMenu = useCallback(
    (a: AlbumDTO): MenuItem[] => [
      {
        label: "Upload here",
        icon: <Upload className="size-4" />,
        onSelect: () => {
          setLoc({ view: "album", albumId: a.id });
          setTimeout(() => fileInput.current?.click(), 50);
        },
      },
      {
        label: "Rename",
        icon: <Pencil className="size-4" />,
        onSelect: async () => {
          const name = await ask({ title: "Rename album", input: { initial: a.name }, confirm: "Rename" });
          if (!name) return;
          setAlbums((prev) => prev.map((x) => (x.id === a.id ? { ...x, name } : x)));
          api(`/api/albums/${a.id}`, { method: "PATCH", json: { name } }).catch((e) => toast.error(e.message));
        },
      },
      { separator: true, label: "" },
      {
        label: "Delete album",
        icon: <Trash2 className="size-4" />,
        danger: true,
        onSelect: async () => {
          const choice = await ask({
            title: `Delete “${a.name}”?`,
            body: a.count ? `It contains ${a.count} items. What should happen to them?` : "The album is empty.",
            choices: a.count
              ? [
                  { value: "unsort", label: "Keep items (Unsorted)" },
                  { value: "trash", label: "Move items to trash", danger: true },
                ]
              : [{ value: "unsort", label: "Delete", danger: true }],
          });
          if (!choice) return;
          await api(`/api/albums/${a.id}?items=${choice}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
          setAlbums((prev) => prev.filter((x) => x.id !== a.id));
          if (loc.view === "album" && loc.albumId === a.id) setLoc({ view: "all" });
        },
      },
    ],
    [ask, loc],
  );

  const itemMenu = useCallback(
    (it: ItemDTO): MenuItem[] => {
      const ids = selected.has(it.id) && selected.size > 1 ? selectedIds() : [it.id];
      const many = ids.length > 1;
      if (it.deletedAt)
        return [
          { label: many ? `Restore ${ids.length} items` : "Restore", icon: <RotateCcw className="size-4" />, onSelect: () => restore(ids) },
          { label: "Delete forever", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => purge(ids) },
        ];
      return [
        ...(many ? [] : [{ label: "Open", icon: <ImageIcon className="size-4" />, hint: "↵", onSelect: () => setLightbox({ id: it.id, list: null }) }]),
        {
          label: it.favorite ? "Remove from favorites" : "Add to favorites",
          icon: <Heart className="size-4" />,
          onSelect: () => toggleFavorite(ids, !it.favorite),
        },
        {
          label: many ? `Move ${ids.length} items to…` : "Move to…",
          icon: <FolderInput className="size-4" />,
          submenu: [
            { label: "New album…", icon: <FolderPlus className="size-4" />, onSelect: async () => {
              const name = await ask({ title: "New album", input: { placeholder: "Album name" }, confirm: "Create & move" });
              if (!name) return;
              const { album: a } = await api<{ album: AlbumDTO }>("/api/albums", { method: "POST", json: { name } });
              setAlbums((p) => [...p, a]);
              moveTo(ids, a.id);
            } },
            { label: "Unsorted", checked: it.albumId === null, onSelect: () => moveTo(ids, null) },
            ...albums.map((a) => ({ label: a.name, checked: a.id === it.albumId, onSelect: () => moveTo(ids, a.id) })),
          ],
        },
        ...(it.albumId && !many
          ? [{ label: "Use as album cover", icon: <Star className="size-4" />, onSelect: () => api(`/api/albums/${it.albumId}`, { method: "PATCH", json: { coverItemId: it.id } }).then(() => toast.success("Album cover updated")) }]
          : []),
        { label: many ? `Download ${ids.length} files` : "Download original", icon: <Download className="size-4" />, onSelect: () => downloadMany(items.filter((x) => ids.includes(x.id))) },
        ...(many ? [] : [{ label: "Rename", icon: <Pencil className="size-4" />, onSelect: () => rename(it) }]),
        { separator: true, label: "" },
        { label: many ? `Move ${ids.length} to trash` : "Move to trash", icon: <Trash2 className="size-4" />, danger: true, hint: "Del", onSelect: () => trash(ids) },
      ];
    },
    [albums, ask, downloadMany, items, moveTo, purge, rename, restore, selected, selectedIds, toggleFavorite, trash],
  );

  const onSelect = useCallback(
    (id: string, mode: "toggle" | "range" | "only") => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (mode === "range" && anchor.current) {
          const list = itemsRef.current;
          const a = list.findIndex((i) => i.id === anchor.current);
          const b = list.findIndex((i) => i.id === id);
          if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(list[i].id);
          return next;
        }
        if (mode === "only") return new Set([id]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const { accepted, skipped } = uploader.add(files, uploadTarget);
      if (skipped) toast(`Skipped ${skipped} file${skipped > 1 ? "s" : ""}`, { description: "Only photos and videos are accepted (or it's already uploading)." });
      if (accepted) toast.success(`Encrypting ${accepted} file${accepted > 1 ? "s" : ""}`, { description: `Into ${uploadTarget ? album?.name : "Unsorted"}` });
    },
    [uploader, uploadTarget, album],
  );

  // Paste images straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        addFiles(files.map((f) => (f.name === "image.png" ? new File([f], `Pasted ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`, { type: f.type }) : f)));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // ─── Keyboard ───
  useEffect(() => {
    let escTimes: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && prefs.panicKey) {
        const now = Date.now();
        escTimes = [...escTimes.filter((t) => now - t < 900), now];
        if (escTimes.length >= 3) return void lock(true);
      }
      // Locking must work even while the shield is up.
      if (e.key === "L" && e.shiftKey && !e.metaKey && !e.ctrlKey && !(e.target as HTMLElement)?.closest("input, textarea")) return void lock();
      if (shield) return unshield();
      if (lightbox || settings || palette || help || ctx) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !lightbox) (e.preventDefault(), setPalette((p) => !p));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return void (e.preventDefault(), setPalette(true));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !(e.target as HTMLElement)?.closest("input")) {
        e.preventDefault();
        return setSelected(new Set(itemsRef.current.map((i) => i.id)));
      }
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "/") (e.preventDefault(), setPalette(true));
      else if (k === "u") fileInput.current?.click();
      else if (k === "n") newAlbum();
      else if (k === "b") setBlurred((b) => !b);
      else if (k === "?") setHelp(true);
      else if (k === "x") setSelectMode((s) => !s);
      else if (k === "Escape") (setSelected(new Set()), setSelectMode(false));
      else if ((k === "Delete" || k === "Backspace") && selected.size) loc.view === "trash" ? purge(selectedIds()) : trash(selectedIds());
      else if (k === "s" && selected.size) {
        const ids = selectedIds();
        toggleFavorite(ids, !items.find((i) => i.id === ids[0])?.favorite);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, help, items, lightbox, loc.view, lock, newAlbum, palette, prefs.panicKey, purge, selected, selectedIds, settings, shield, toggleFavorite, trash, unshield]);

  // ─── Drag & drop ───
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collision: CollisionDetection = useCallback((args) => {
    const type = args.active.data.current?.type;
    if (type === "item") {
      const hits = pointerWithin(args).filter((c) => args.droppableContainers.find((d) => d.id === c.id)?.data.current?.type === "album");
      if (hits.length) return hits;
    }
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => d.data.current?.type === type) });
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type: "item" | "album"; id: string };
    if (d.type === "item") {
      const ids = selected.has(d.id) ? items.filter((i) => selected.has(i.id)).map((i) => i.id) : [d.id];
      setDrag({ type: "item", ids, item: items.find((i) => i.id === d.id) });
    } else setDrag({ type: "album", ids: [d.id] });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const current = drag;
    setDrag(null);
    const a = e.active.data.current as { type: string; id: string } | undefined;
    const o = e.over?.data.current as { type: string; id: string | null } | undefined;
    if (!a || !o || !current) return;

    if (a.type === "item" && o.type === "album") {
      const target = o.id;
      const here = loc.view === "album" ? loc.albumId : loc.view === "unsorted" ? null : undefined;
      if (target !== here) moveTo(current.ids, target);
      return;
    }
    if (a.type === "item" && o.type === "item" && canReorder && a.id !== o.id) {
      const ids = current.ids;
      const moving = new Set(ids);
      const from = items.findIndex((i) => i.id === a.id);
      const to = items.findIndex((i) => i.id === o.id);
      let next: ItemDTO[];
      if (ids.length === 1) next = arrayMove(items, from, to);
      else {
        if (!o.id || moving.has(o.id)) return;
        const rest = items.filter((i) => !moving.has(i.id));
        const block = items.filter((i) => moving.has(i.id));
        const overIdx = rest.findIndex((i) => i.id === o.id);
        const insertAt = to > from ? overIdx + 1 : overIdx;
        next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
      }
      const firstIdx = next.findIndex((i) => moving.has(i.id));
      const prevId = firstIdx > 0 ? next[firstIdx - 1].id : null;
      setItems(next);
      act({ action: "reorder", ids: next.filter((i) => moving.has(i.id)).map((i) => i.id), albumId: loc.view === "album" ? loc.albumId : null, prevId });
      return;
    }
    if (a.type === "album" && o.type === "album" && o.id && a.id !== o.id) {
      const from = albums.findIndex((x) => x.id === a.id);
      const to = albums.findIndex((x) => x.id === o.id);
      const next = arrayMove(albums, from, to);
      setAlbums(next);
      const idx = next.findIndex((x) => x.id === a.id);
      api(`/api/albums/${a.id}`, { method: "PATCH", json: { prevId: idx > 0 ? next[idx - 1].id : null } }).catch(() => refreshMeta());
    }
  };

  // ─── Commands ───
  const commands: Command[] = useMemo(
    () => [
      { id: "upload", label: "Upload photos & videos", icon: <Upload className="size-4" />, hint: "U", run: () => fileInput.current?.click() },
      { id: "album", label: "New album", icon: <FolderPlus className="size-4" />, hint: "N", run: newAlbum },
      { id: "blur", label: blurred ? "Reveal thumbnails" : "Blur thumbnails", icon: blurred ? <Eye className="size-4" /> : <EyeOff className="size-4" />, hint: "B", run: () => setBlurred((b) => !b), keywords: "privacy hide" },
      { id: "select", label: "Select items", icon: <CheckSquare className="size-4" />, hint: "X", run: () => setSelectMode(true) },
      { id: "photos", label: "Go to Photos", icon: <ImageIcon className="size-4" />, run: () => setLoc({ view: "photos" }) },
      { id: "videos", label: "Go to Videos", icon: <Video className="size-4" />, run: () => setLoc({ view: "videos" }) },
      { id: "fav", label: "Go to Favorites", icon: <Heart className="size-4" />, run: () => setLoc({ view: "favorites" }) },
      { id: "trash", label: "Go to Trash", icon: <Trash2 className="size-4" />, run: () => setLoc({ view: "trash" }) },
      { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" />, run: () => setSettings(true), keywords: "2fa password sessions security" },
      { id: "keys", label: "Keyboard shortcuts", icon: <Keyboard className="size-4" />, hint: "?", run: () => setHelp(true) },
      { id: "lock", label: "Lock vault", icon: <Lock className="size-4" />, hint: "⇧L", run: () => lock(), keywords: "logout sign out" },
    ],
    [blurred, lock, newAlbum],
  );

  const navigate = (l: Location) => {
    setLoc(l);
    setSort(defaultSort(l));
    setKind("all");
    setQuery("");
    setMobileNav(false);
    setSelectMode(false);
    window.scrollTo({ top: 0 });
  };

  const changeSort = (s: Sort) => {
    setSort(s);
    lsSet(`vault:sort:${locKey(loc)}`, s);
  };

  const lightboxList = lightbox?.list ?? items;
  const lightboxIndex = lightbox ? lightboxList.findIndex((i) => i.id === lightbox.id) : -1;
  const sortOptions: SortKey[] = loc.view === "album" || loc.view === "unsorted" ? ["manual", "added", "taken", "name", "size", "duration"] : ["added", "taken", "name", "size", "duration"];

  const sidebar = (
    <Sidebar
      location={loc}
      albums={albums}
      stats={stats}
      dragging={drag?.type ?? null}
      onNavigate={navigate}
      onNewAlbum={newAlbum}
      albumMenu={albumMenu}
    />
  );

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
      <div id="vault-root" className={cx("flex min-h-dvh", blurred && "privacy-blur", prefs.peekOnHover && "peek")} style={{ ["--tile" as string]: `${prefs.tile}px` }}>
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-white/[0.05] bg-ink-950/40 backdrop-blur-xl md:block">{sidebar}</aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div className="fixed inset-0 z-[65] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNav(false)} />
              <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", damping: 32, stiffness: 340 }} className="glass absolute inset-y-0 left-0 w-72">
                {sidebar}
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1">
          {/* Toolbar */}
          <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-ink-950/70 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-2 px-3 sm:px-5">
              <IconButton label="Menu" className="md:hidden" onClick={() => setMobileNav(true)}>
                <Menu className="size-5" />
              </IconButton>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
                <p className="text-xs text-ink-500">
                  {loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "item" : "items"}`}
                  {canReorder && total > 1 && <span className="max-sm:hidden"> · drag to reorder</span>}
                </p>
              </div>

              <div className="relative max-lg:hidden">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by name"
                  className="h-9 w-52 rounded-xl border border-white/[0.06] bg-white/[0.04] pr-3 pl-9 text-[13px] outline-none transition placeholder:text-ink-500 focus:w-64 focus:border-accent-500/50"
                />
              </div>

              {loc.view !== "photos" && loc.view !== "videos" && (
                <div className="max-sm:hidden">
                  <Segmented
                    value={kind}
                    onChange={setKind}
                    options={[
                      { value: "all", label: "All" },
                      { value: "image", label: <ImageIcon className="size-3.5" />, title: "Photos only" },
                      { value: "video", label: <Video className="size-3.5" />, title: "Videos only" },
                    ]}
                  />
                </div>
              )}

              <MenuButton
                label="Sort"
                className="h-9 gap-1.5 rounded-xl px-2.5 text-[13px] text-ink-300 hover:bg-white/[0.06] hover:text-white"
                items={() => [
                  ...sortOptions.map((k) => ({
                    label: SORT_LABEL[k],
                    checked: sort.key === k,
                    onSelect: () => changeSort({ key: k, dir: k === "name" ? "asc" : sort.key === k ? sort.dir : "desc" }),
                  })),
                  ...(sort.key !== "manual"
                    ? [
                        { separator: true, label: "" },
                        { label: sort.dir === "asc" ? "Ascending" : "Descending", icon: <ArrowDownUp className="size-4" />, onSelect: () => changeSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" }) },
                      ]
                    : []),
                ]}
              >
                <ArrowDownUp className="size-4" />
                <span className="max-sm:hidden">{SORT_LABEL[sort.key]}</span>
              </MenuButton>

              <input
                type="range"
                min={110}
                max={340}
                value={prefs.tile}
                onChange={(e) => setPrefs({ tile: Number(e.target.value) })}
                aria-label="Thumbnail size"
                title="Thumbnail size"
                className="slider w-24 max-xl:hidden"
                style={{ ["--fill" as string]: `${((prefs.tile - 110) / 230) * 100}%` }}
              />

              <IconButton label={selectMode ? "Done selecting (x)" : "Select (x)"} active={selectMode} onClick={() => (setSelectMode((s) => !s), selectMode && setSelected(new Set()))}>
                <CheckSquare className="size-[18px]" />
              </IconButton>
              <IconButton label={blurred ? "Reveal (b)" : "Blur (b)"} active={blurred} onClick={() => setBlurred((b) => !b)}>
                {blurred ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
              </IconButton>
              <IconButton label="Search & commands (⌘K)" onClick={() => setPalette(true)} className="lg:hidden">
                <Search className="size-[18px]" />
              </IconButton>
              {loc.view !== "trash" && (
                <Button variant="primary" size="sm" onClick={() => fileInput.current?.click()} className="max-sm:size-9 max-sm:px-0">
                  <Upload className="size-4" />
                  <span className="max-sm:hidden">Upload</span>
                </Button>
              )}
              <MenuButton
                label="More"
                className="size-9 justify-center rounded-xl text-ink-300 hover:bg-white/[0.07] hover:text-white"
                items={[
                  ...(album ? albumMenu(album) : []),
                  ...(album ? [{ separator: true, label: "" }] : []),
                  { label: "Command palette", icon: <CommandIcon className="size-4" />, hint: "⌘K", onSelect: () => setPalette(true) },
                  { label: "Keyboard shortcuts", icon: <Keyboard className="size-4" />, hint: "?", onSelect: () => setHelp(true) },
                  { label: "Settings", icon: <SettingsIcon className="size-4" />, onSelect: () => setSettings(true) },
                  { separator: true, label: "" },
                  { label: "Lock vault", icon: <Lock className="size-4" />, hint: "⇧L", onSelect: () => lock() },
                ]}
              >
                <MoreHorizontal className="size-5" />
              </MenuButton>
            </div>
          </header>

          {/* Content */}
          <section className="px-1.5 py-3 sm:px-5 sm:py-5">
            {loc.view === "trash" && items.length > 0 && (
              <p className="mb-4 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-xs text-ink-400">
                Items in the trash are shredded automatically after 30 days.
              </p>
            )}
            {!loading && !items.length ? (
              <EmptyState view={loc.view} filtered={!!debouncedQuery || kind !== "all"} onUpload={() => fileInput.current?.click()} />
            ) : loading && !items.length ? (
              <div className="grid-tiles">
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className="shimmer aspect-square rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            ) : (
              <Grid
                items={items}
                selected={selected}
                selectMode={selectMode || selected.size > 0}
                canReorder={canReorder}
                draggable={loc.view !== "trash"}
                hoverPreview={prefs.hoverPreview}
                blurred={blurred}
                onOpen={(i) => setLightbox({ id: items[i].id, list: null })}
                onSelect={onSelect}
                onContext={(item, at) => setCtx({ item, at })}
                onFavorite={(it) => toggleFavorite([it.id], !it.favorite)}
                onRetry={(it) => act({ action: "retry", ids: [it.id] })}
                onEndReached={() => items.length < total && !loading && load(false)}
                hasMore={items.length < total}
                draggingIds={drag?.type === "item" && drag.ids.length > 1 ? new Set(drag.ids) : new Set()}
              />
            )}
          </section>
        </main>
      </div>

      <DragOverlay dropAnimation={null}>{drag?.type === "item" && drag.item ? <TileOverlay item={drag.item} count={drag.ids.length} /> : null}</DragOverlay>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="glass fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 pl-4 shadow-2xl shadow-black/60"
          >
            <span className="mr-2 text-sm font-medium whitespace-nowrap tabular-nums">{selected.size} selected</span>
            {loc.view === "trash" ? (
              <>
                <Button size="sm" onClick={() => restore(selectedIds())}>
                  <RotateCcw className="size-4" /> Restore
                </Button>
                <Button size="sm" variant="danger" onClick={() => purge(selectedIds())}>
                  <Trash2 className="size-4" /> Delete forever
                </Button>
              </>
            ) : (
              <>
                <IconButton label="Favorite (s)" onClick={() => toggleFavorite(selectedIds(), !items.find((i) => selected.has(i.id))?.favorite)}>
                  <Heart className="size-[18px]" />
                </IconButton>
                <MenuButton
                  label="Move to album"
                  className="size-9 justify-center rounded-xl text-ink-300 hover:bg-white/[0.07] hover:text-white"
                  items={() => [
                    { label: "New album…", icon: <FolderPlus className="size-4" />, onSelect: newAlbum },
                    { label: "Unsorted", onSelect: () => moveTo(selectedIds(), null) },
                    { separator: true, label: "" },
                    ...albums.map((a) => ({ label: a.name, onSelect: () => moveTo(selectedIds(), a.id) })),
                  ]}
                >
                  <FolderInput className="size-[18px]" />
                </MenuButton>
                <IconButton label="Download" onClick={() => downloadMany(items.filter((i) => selected.has(i.id)))}>
                  <Download className="size-[18px]" />
                </IconButton>
                <IconButton label="Move to trash (Del)" onClick={() => trash(selectedIds())}>
                  <Trash2 className="size-[18px]" />
                </IconButton>
              </>
            )}
            <div className="mx-1 h-6 w-px bg-white/10" />
            <IconButton label="Select all (⌘A)" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
              <CheckSquare className="size-[18px]" />
            </IconButton>
            <IconButton label="Clear selection (Esc)" onClick={() => (setSelected(new Set()), setSelectMode(false))}>
              <X className="size-[18px]" />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>

      <FloatingMenu at={ctx?.at ?? null} items={ctx ? itemMenu(ctx.item) : []} onClose={() => setCtx(null)} />

      <AnimatePresence>
        {lightbox && lightboxIndex >= 0 && (
          <Lightbox
            items={lightboxList}
            index={lightboxIndex}
            albums={albums}
            onIndex={(i) => setLightbox((l) => (l ? { ...l, id: lightboxList[i].id } : l))}
            onClose={() => setLightbox(null)}
            onFavorite={(it) => {
              toggleFavorite([it.id], !it.favorite);
              if (lightbox.list) setLightbox((l) => l && { ...l, list: l.list!.map((x) => (x.id === it.id ? { ...x, favorite: !it.favorite } : x)) });
            }}
            onTrash={(it) => {
              const next = lightboxList[lightboxIndex + 1] ?? lightboxList[lightboxIndex - 1];
              trash([it.id]);
              if (next) setLightbox((l) => l && { id: next.id, list: l.list?.filter((x) => x.id !== it.id) ?? null });
              else setLightbox(null);
            }}
            onRestore={(it) => {
              restore([it.id]);
              setLightbox(null);
            }}
            onRename={(it, n) => rename(it, n)}
            onMove={(it, a) => {
              moveTo([it.id], a);
              if (loc.view === "album" || loc.view === "unsorted") setLightbox(null);
            }}
            onNearEnd={() => !lightbox.list && items.length < total && load(false)}
          />
        )}
      </AnimatePresence>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        commands={commands}
        albums={albums}
        onAlbum={(a) => navigate({ view: "album", albumId: a.id })}
        onItem={(list, index) => setLightbox({ id: list[index].id, list })}
      />
      <Settings open={settings} onClose={() => setSettings(false)} stats={stats} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
      <UploadTray uploader={uploader} />
      <DropOverlay onFiles={addFiles} target={uploadTarget ? album?.name ?? "this album" : "Unsorted"} />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mkv,.avi,.wmv,.flv,.mpg,.mpeg,.3gp,.mov,.m4v,.ts"
        className="hidden"
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {/* Privacy shield */}
      <AnimatePresence>
        {shield && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={unshield}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-ink-950/80 backdrop-blur-3xl"
            aria-label="Reveal vault"
          >
            <div className="flex size-16 items-center justify-center rounded-3xl bg-white/[0.06]">
              <EyeOff className="size-7 text-ink-300" />
            </div>
            <p className="text-sm text-ink-300">Hidden while you were away · click to reveal</p>
            <span className="text-xs text-ink-500">
              <Kbd>Shift</Kbd> + <Kbd>L</Kbd> to lock
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </DndContext>
  );
}

function EmptyState({ view, filtered, onUpload }: { view: string; filtered: boolean; onUpload: () => void }) {
  const copy = filtered
    ? { t: "No matches", d: "Try a different filter or search." }
    : view === "trash"
      ? { t: "Trash is empty", d: "Deleted items stay here for 30 days." }
      : view === "favorites"
        ? { t: "No favorites yet", d: "Tap the heart on anything you love." }
        : { t: "Nothing here yet", d: "Drop photos and videos anywhere on this page, paste from the clipboard, or pick files." };
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-accent-500/30 blur-3xl" />
        <div className="relative flex size-20 items-center justify-center rounded-[28px] border border-white/[0.08] bg-white/[0.04]">
          {view === "trash" ? <Trash2 className="size-8 text-ink-300" /> : view === "favorites" ? <Heart className="size-8 text-ink-300" /> : <ImageIcon className="size-8 text-ink-300" />}
        </div>
      </div>
      <h2 className="mt-6 text-lg font-semibold">{copy.t}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-ink-400">{copy.d}</p>
      {!filtered && view !== "trash" && view !== "favorites" && (
        <Button variant="primary" className="mt-6" onClick={onUpload}>
          <Upload className="size-4" /> Upload
        </Button>
      )}
    </div>
  );
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups: [string, [string, string][]][] = [
    ["Library", [["⌘K  /", "Search & commands"], ["U", "Upload"], ["N", "New album"], ["B", "Blur / reveal"], ["X", "Select mode"], ["⌘A", "Select all"], ["S", "Favorite selection"], ["Del", "Trash selection"], ["⇧L", "Lock"], ["Esc ×3", "Panic: lock & leave"]]],
    ["Viewer", [["← →", "Previous / next"], ["Space", "Slideshow"], ["F", "Fullscreen"], ["I", "Info"], ["S", "Favorite"], ["D", "Download"], ["Scroll / pinch", "Zoom"]]],
    ["Video", [["K / Space", "Play / pause"], ["J  L", "−10s / +10s"], ["⇧← ⇧→", "−5s / +5s"], ["↑ ↓", "Volume"], ["M", "Mute"], [", .", "Frame step"], ["< >", "Speed"], ["0–9", "Jump to %"], ["P", "Picture in picture"], ["R", "Loop"]]],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" wide>
      <div className="grid gap-6 p-5 sm:grid-cols-3">
        {groups.map(([g, rows]) => (
          <div key={g}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">{g}</h3>
            <div className="space-y-1.5">
              {rows.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-300">{d}</span>
                  <Kbd>{k}</Kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
