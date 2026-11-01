import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handle, json, readJson } from "@/lib/server/http";
import { deleteAlbum, getAlbum, getItem, moveAlbum, updateAlbum } from "@/lib/server/media";
import { AlbumName, Uuid } from "@/lib/server/schemas";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  name: AlbumName.optional(),
  coverItemId: Uuid.nullable().optional(),
  /** Reorder: place this album right after `prevId` (null = first). */
  prevId: Uuid.nullable().optional(),
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const id = Uuid.parse((await params).id);
  if (!getAlbum(id)) throw new ApiError(404, "Album not found");
  const body = await readJson(req, Patch);
  if (body.coverItemId) {
    const item = getItem(body.coverItemId);
    if (!item || item.album_id !== id) throw new ApiError(400, "Cover must be an item in this album");
  }
  if (body.name !== undefined || body.coverItemId !== undefined) updateAlbum(id, { name: body.name, coverItemId: body.coverItemId });
  if (body.prevId !== undefined) moveAlbum(id, body.prevId);
  return json({ ok: true });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const id = Uuid.parse((await params).id);
  if (!getAlbum(id)) throw new ApiError(404, "Album not found");
  const mode = req.nextUrl.searchParams.get("items") === "trash" ? "trash" : "unsort";
  deleteAlbum(id, mode);
  return json({ ok: true });
});
