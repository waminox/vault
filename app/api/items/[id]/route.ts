import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handle, json, readJson } from "@/lib/server/http";
import { getItem, setFavorite, toDTO, updateItem } from "@/lib/server/media";
import { ItemName, Uuid } from "@/lib/server/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const item = getItem(Uuid.parse((await params).id));
  if (!item) throw new ApiError(404, "Not found");
  return json({ item: toDTO(item) });
});

const Patch = z.object({ name: ItemName.optional(), favorite: z.boolean().optional() });

export const PATCH = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const id = Uuid.parse((await params).id);
  if (!getItem(id)) throw new ApiError(404, "Not found");
  const body = await readJson(req, Patch);
  if (body.name !== undefined) updateItem(id, { name: body.name });
  if (body.favorite !== undefined) setFavorite([id], body.favorite);
  return json({ item: toDTO(getItem(id)!) });
});
