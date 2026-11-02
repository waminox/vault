import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { config } from "./config";
import { db, tx } from "./db";
import { publish } from "./events";
import { deleteBlob } from "./storage";
import type { AlbumDTO, ItemDTO, ListQuery, Stats, Storyboard, Variants } from "../types";

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface ItemRow {
  id: string;
  album_id: string | null;
  kind: "image" | "video";
  name: string;
  mime: string;
  size: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  taken_at: number | null;
  created_at: number;
  updated_at: number;
  position: string;
  favorite: number;
  deleted_at: number | null;
  color: string | null;
  status: "processing" | "ready" | "failed";
  progress: number | null;
  error: string | null;
  variants: string;
}

interface AlbumRow {
  id: string;
  name: string;
  position: string;
  cover_item_id: string | null;
  created_at: number;
  updated_at: number;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function parseVariants(row: Pick<ItemRow, "variants">): Variants {
  try {
    return JSON.parse(row.variants) as Variants;
  } catch {
    return {};
  }
}

/** Stable per-content revision: changes only when the stored variants change. */
export function mediaRev(variants: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < variants.length; i++) h = Math.imul(h ^ variants.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function toDTO(row: ItemRow): ItemDTO {
  const v = parseVariants(row);
  const sb = v.storyboard as (Variants["storyboard"] & Storyboard) | undefined;
  return {
    id: row.id,
    albumId: row.album_id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    duration: row.duration,
    takenAt: row.taken_at,
    createdAt: row.created_at,
    rev: mediaRev(row.variants),
    position: row.position,
    favorite: !!row.favorite,
    deletedAt: row.deleted_at,
    color: row.color,
    status: row.status,
    progress: row.progress,
    error: row.error,
    has: {
      thumb: !!v.thumb,
      preview: !!v.preview,
      poster: !!v.poster,
      playback: !!v.playback,
      original: !!v.original,
    },
    storyboard: sb ? { cols: sb.cols, rows: sb.rows, interval: sb.interval, tileW: sb.tileW, tileH: sb.tileH, count: sb.count } : null,
  };
}

// ─── Items ───────────────────────────────────────────────────────────────────

export function getItem(id: string): ItemRow | undefined {
  return db().prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
}

export function getItems(ids: string[]): ItemRow[] {
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  return db().prepare(`SELECT * FROM items WHERE id IN (${ph})`).all(...ids) as unknown as ItemRow[];
}

const SORTS: Record<ListQuery["sort"], string> = {
  manual: "position",
  added: "created_at",
  taken: "COALESCE(taken_at, created_at)",
  name: "name COLLATE NOCASE",
  size: "size",
  duration: "COALESCE(duration, -1)",
};

export function listItems(q: ListQuery): { items: ItemDTO[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (q.view === "trash") where.push("deleted_at IS NOT NULL");
  else where.push("deleted_at IS NULL");

  switch (q.view) {
    case "album":
      where.push("album_id = ?");
      args.push(q.albumId ?? "");
      break;
    case "unsorted":
      where.push("album_id IS NULL");
      break;
    case "photos":
      where.push("kind = 'image'");
      break;
    case "videos":
      where.push("kind = 'video'");
      break;
    case "favorites":
      where.push("favorite = 1");
      break;
  }
  if (q.kind) {
    where.push("kind = ?");
    args.push(q.kind);
  }
  if (q.q) {
    where.push("name LIKE ? ESCAPE '\\'");
    args.push(`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  // Manual order only exists inside one container; elsewhere fall back to "added".
  const manualOk = q.view === "album" || q.view === "unsorted";
  const sortKey = q.sort === "manual" && !manualOk ? "added" : q.sort;
  const trashSort = q.view === "trash" ? "deleted_at DESC, " : "";
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const effectiveDir = sortKey === "manual" ? "ASC" : dir;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = db()
    .prepare(`SELECT * FROM items ${whereSql} ORDER BY ${trashSort}${SORTS[sortKey]} ${effectiveDir}, id ${effectiveDir} LIMIT ? OFFSET ?`)
    .all(...args, q.limit, q.offset) as unknown as ItemRow[];
  const { n } = db().prepare(`SELECT COUNT(*) AS n FROM items ${whereSql}`).get(...args) as { n: number };
  return { items: rows.map(toDTO), total: n };
}

export function lastPosition(albumId: string | null): string | null {
  const row = db()
    .prepare("SELECT MAX(position) AS p FROM items WHERE album_id IS ? AND deleted_at IS NULL")
    .get(albumId) as { p: string | null };
  return row.p;
}

export function findDuplicate(sha256: string, exceptId?: string): ItemRow | undefined {
  return db()
    .prepare("SELECT * FROM items WHERE sha256 = ? AND deleted_at IS NULL AND id != ? AND status != 'failed' LIMIT 1")
    .get(sha256, exceptId ?? "") as ItemRow | undefined;
}

export interface NewItem {
  id?: string;
  albumId: string | null;
  kind: "image" | "video";
  name: string;
  mime: string;
  size: number;
  takenAt?: number | null;
  createdAt?: number;
}

export function insertItem(n: NewItem): ItemRow {
  const id = n.id ?? newId();
  const now = Date.now();
  tx(() => {
    const pos = generateKeyBetween(lastPosition(n.albumId), null);
    db()
      .prepare(
        `INSERT INTO items(id, album_id, kind, name, mime, size, taken_at, created_at, updated_at, position, status, progress)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0)`,
      )
      .run(id, n.albumId, n.kind, n.name, n.mime, n.size, n.takenAt ?? null, n.createdAt ?? now, now, pos);
  });
  return getItem(id)!;
}

type ItemPatch = Partial<
  Pick<ItemRow, "name" | "mime" | "size" | "sha256" | "width" | "height" | "duration" | "taken_at" | "color" | "status" | "progress" | "error" | "favorite">
> & { variants?: Variants };

export function updateItem(id: string, patch: ItemPatch, { notify = true } = {}): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    args.push(k === "variants" ? JSON.stringify(v) : (v as string | number | null));
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  args.push(Date.now());
  db().prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  if (notify) publish({ type: "item.upsert", ids: [id] });
}

export function setProgress(id: string, progress: number): void {
  db().prepare("UPDATE items SET progress = ? WHERE id = ?").run(progress, id);
  publish({ type: "item.progress", id, progress });
}

/**
 * Move a block of items so they sit right after `prevId` (null = at the start)
 * inside `albumId`, preserving their relative order. Only the moved rows are
 * rewritten thanks to fractional (lexicographic) positions.
 */
export function moveItems(ids: string[], albumId: string | null, prevId: string | null): void {
  if (!ids.length) return;
  tx(() => {
    const moving = new Set(ids);
    let prevPos: string | null = null;
    if (prevId) {
      if (moving.has(prevId)) throw new Error("prevId cannot be one of the moved items");
      const prev = getItem(prevId);
      if (!prev || prev.album_id !== albumId) throw new Error("prevId is not in the target album");
      prevPos = prev.position;
    }
    const ph = ids.map(() => "?").join(",");
    const next = db()
      .prepare(
        `SELECT position FROM items WHERE album_id IS ? AND deleted_at IS NULL AND id NOT IN (${ph})
         AND (? IS NULL OR position > ?) ORDER BY position ASC LIMIT 1`,
      )
      .get(albumId, ...ids, prevPos, prevPos) as { position: string } | undefined;
    // The client sends ids in the visual order the block should keep.
    const existing = new Set(getItems(ids).filter((r) => r.deleted_at === null).map((r) => r.id));
    const order = ids.filter((id) => existing.has(id));
    if (!order.length) return;
    const keys = generateNKeysBetween(prevPos, next?.position ?? null, order.length);
    const now = Date.now();
    const stmt = db().prepare("UPDATE items SET position = ?, album_id = ?, updated_at = ? WHERE id = ?");
    order.forEach((id, i) => stmt.run(keys[i], albumId, now, id));
  });
  publish({ type: "item.upsert", ids });
  publish({ type: "albums.changed" });
}

/** Move items to the end of another album (or Unsorted). */
export function moveToAlbum(ids: string[], albumId: string | null): void {
  if (albumId && !getAlbum(albumId)) throw new Error("Album not found");
  tx(() => {
    let pos = lastPosition(albumId);
    const now = Date.now();
    const stmt = db().prepare("UPDATE items SET album_id = ?, position = ?, updated_at = ? WHERE id = ?");
    for (const row of getItems(ids).sort((a, b) => (a.position < b.position ? -1 : 1))) {
      if (row.album_id === albumId) continue;
      pos = generateKeyBetween(pos, null);
      stmt.run(albumId, pos, now, row.id);
    }
  });
  publish({ type: "item.upsert", ids });
  publish({ type: "albums.changed" });
}

export function setFavorite(ids: string[], favorite: boolean): void {
  const ph = ids.map(() => "?").join(",");
  db().prepare(`UPDATE items SET favorite = ?, updated_at = ? WHERE id IN (${ph})`).run(favorite ? 1 : 0, Date.now(), ...ids);
  publish({ type: "item.upsert", ids });
}

export function trashItems(ids: string[]): void {
  const ph = ids.map(() => "?").join(",");
  const now = Date.now();
  db().prepare(`UPDATE items SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (${ph})`).run(now, now, ...ids);
  db().prepare(`UPDATE albums SET cover_item_id = NULL WHERE cover_item_id IN (${ph})`).run(...ids);
  publish({ type: "item.removed", ids });
  publish({ type: "albums.changed" });
}

export function restoreItems(ids: string[]): void {
  tx(() => {
    const now = Date.now();
    for (const row of getItems(ids)) {
      if (row.deleted_at === null) continue;
      // The album may have been deleted meanwhile.
      const albumId = row.album_id && getAlbum(row.album_id) ? row.album_id : null;
      const pos = generateKeyBetween(lastPosition(albumId), null);
      db().prepare("UPDATE items SET deleted_at = NULL, album_id = ?, position = ?, updated_at = ? WHERE id = ?").run(albumId, pos, now, row.id);
    }
  });
  publish({ type: "item.upsert", ids });
  publish({ type: "albums.changed" });
}

/** Permanently remove items and shred their blobs. */
export async function purgeItems(ids: string[]): Promise<void> {
  const rows = getItems(ids);
  for (const row of rows) {
    const v = parseVariants(row);
    // Leftover plaintext from an ingest that never finished.
    const pending = db().prepare("SELECT payload FROM jobs WHERE item_id = ? AND type = 'ingest'").all(row.id) as { payload: string | null }[];
    for (const job of pending) {
      try {
        const p = JSON.parse(job.payload ?? "{}") as { src?: string; poster?: string };
        for (const f of [p.src, p.poster]) if (f && f.startsWith(config.dataDir)) await fsp.rm(f, { force: true });
      } catch {}
    }
    db().prepare("DELETE FROM items WHERE id = ?").run(row.id);
    db().prepare("DELETE FROM jobs WHERE item_id = ?").run(row.id);
    for (const variant of Object.values(v)) await deleteBlob(variant?.blob);
  }
  if (rows.length) {
    publish({ type: "item.removed", ids: rows.map((r) => r.id) });
    publish({ type: "albums.changed" });
  }
}

export async function purgeExpiredTrash(): Promise<number> {
  const cutoff = Date.now() - config.trashDays * 86400_000;
  const rows = db().prepare("SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(cutoff) as { id: string }[];
  await purgeItems(rows.map((r) => r.id));
  return rows.length;
}

// ─── Albums ──────────────────────────────────────────────────────────────────

export function getAlbum(id: string): AlbumRow | undefined {
  return db().prepare("SELECT * FROM albums WHERE id = ?").get(id) as AlbumRow | undefined;
}

export function listAlbums(): AlbumDTO[] {
  const rows = db()
    .prepare(
      `SELECT a.*,
         (SELECT COUNT(*) FROM items i WHERE i.album_id = a.id AND i.deleted_at IS NULL) AS count,
         (SELECT COALESCE(SUM(size), 0) FROM items i WHERE i.album_id = a.id AND i.deleted_at IS NULL) AS bytes,
         COALESCE(
           (SELECT i.id FROM items i WHERE i.id = a.cover_item_id AND i.deleted_at IS NULL),
           (SELECT i.id FROM items i WHERE i.album_id = a.id AND i.deleted_at IS NULL AND i.status = 'ready' ORDER BY i.position LIMIT 1)
         ) AS cover,
         (SELECT i.variants FROM items i WHERE i.id = COALESCE(
           (SELECT i2.id FROM items i2 WHERE i2.id = a.cover_item_id AND i2.deleted_at IS NULL),
           (SELECT i3.id FROM items i3 WHERE i3.album_id = a.id AND i3.deleted_at IS NULL AND i3.status = 'ready' ORDER BY i3.position LIMIT 1)
         )) AS cover_variants
       FROM albums a ORDER BY a.position ASC`,
    )
    .all() as unknown as (AlbumRow & { count: number; bytes: number; cover: string | null; cover_variants: string | null })[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    count: r.count,
    bytes: r.bytes,
    coverId: r.cover,
    coverRev: r.cover_variants ? mediaRev(r.cover_variants) : null,
    createdAt: r.created_at,
  }));
}

export function findAlbumByName(name: string): AlbumRow | undefined {
  return db().prepare("SELECT * FROM albums WHERE name = ? COLLATE NOCASE").get(name) as AlbumRow | undefined;
}

export function createAlbum(name: string): AlbumDTO {
  const id = newId();
  const now = Date.now();
  tx(() => {
    const { p } = db().prepare("SELECT MAX(position) AS p FROM albums").get() as { p: string | null };
    db()
      .prepare("INSERT INTO albums(id, name, position, created_at, updated_at) VALUES(?, ?, ?, ?, ?)")
      .run(id, name, generateKeyBetween(p, null), now, now);
  });
  publish({ type: "albums.changed" });
  return listAlbums().find((a) => a.id === id)!;
}

export function updateAlbum(id: string, patch: { name?: string; coverItemId?: string | null }): void {
  if (!getAlbum(id)) throw new Error("Album not found");
  if (patch.name !== undefined) db().prepare("UPDATE albums SET name = ?, updated_at = ? WHERE id = ?").run(patch.name, Date.now(), id);
  if (patch.coverItemId !== undefined) {
    db().prepare("UPDATE albums SET cover_item_id = ?, updated_at = ? WHERE id = ?").run(patch.coverItemId, Date.now(), id);
  }
  publish({ type: "albums.changed" });
}

export function moveAlbum(id: string, prevId: string | null): void {
  tx(() => {
    const prev = prevId ? getAlbum(prevId) : undefined;
    if (prevId && !prev) throw new Error("prevId not found");
    const next = db()
      .prepare("SELECT position FROM albums WHERE id != ? AND (? IS NULL OR position > ?) ORDER BY position LIMIT 1")
      .get(id, prev?.position ?? null, prev?.position ?? null) as { position: string } | undefined;
    db().prepare("UPDATE albums SET position = ?, updated_at = ? WHERE id = ?").run(generateKeyBetween(prev?.position ?? null, next?.position ?? null), Date.now(), id);
  });
  publish({ type: "albums.changed" });
}

/** Delete an album. Its items go to Unsorted, or to the trash. */
export function deleteAlbum(id: string, mode: "unsort" | "trash"): void {
  const ids = (db().prepare("SELECT id FROM items WHERE album_id = ? AND deleted_at IS NULL").all(id) as { id: string }[]).map((r) => r.id);
  if (mode === "trash" && ids.length) trashItems(ids);
  else if (ids.length) moveToAlbum(ids, null);
  db().prepare("DELETE FROM albums WHERE id = ?").run(id);
  publish({ type: "albums.changed" });
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function stats(): Stats {
  const r = db()
    .prepare(
      `SELECT
        SUM(CASE WHEN deleted_at IS NULL AND kind = 'image' THEN 1 ELSE 0 END) AS photos,
        SUM(CASE WHEN deleted_at IS NULL AND kind = 'video' THEN 1 ELSE 0 END) AS videos,
        SUM(CASE WHEN deleted_at IS NULL AND favorite = 1 THEN 1 ELSE 0 END) AS favorites,
        SUM(CASE WHEN deleted_at IS NULL AND album_id IS NULL THEN 1 ELSE 0 END) AS unsorted,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash,
        COALESCE(SUM(size), 0) AS bytes
       FROM items`,
    )
    .get() as Record<string, number | null>;
  const all = db().prepare("SELECT variants FROM items").all() as { variants: string }[];
  let stored = 0;
  for (const row of all) for (const v of Object.values(parseVariants(row))) stored += v?.size ?? 0;
  const processing = (db().prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'processing'").get() as { n: number }).n;
  return {
    photos: r.photos ?? 0,
    videos: r.videos ?? 0,
    favorites: r.favorites ?? 0,
    unsorted: r.unsorted ?? 0,
    trash: r.trash ?? 0,
    bytes: r.bytes ?? 0,
    storedBytes: stored,
    processing,
  };
}
