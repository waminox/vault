import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handle, json, readJson } from "@/lib/server/http";
import { getAlbum, moveItems, moveToAlbum, purgeItems, restoreItems, setFavorite, trashItems } from "@/lib/server/media";
import { retryItem } from "@/lib/server/processing";
import { Uuid } from "@/lib/server/schemas";

const Ids = z.array(Uuid).min(1).max(5000);

const Action = z.discriminatedUnion("action", [
  /** Drag & drop reordering: put `ids` right after `prevId` inside `albumId`. */
  z.object({ action: z.literal("reorder"), ids: Ids, albumId: Uuid.nullable(), prevId: Uuid.nullable() }),
  z.object({ action: z.literal("move"), ids: Ids, albumId: Uuid.nullable() }),
  z.object({ action: z.literal("favorite"), ids: Ids, value: z.boolean() }),
  z.object({ action: z.literal("trash"), ids: Ids }),
  z.object({ action: z.literal("restore"), ids: Ids }),
  z.object({ action: z.literal("purge"), ids: Ids }),
  z.object({ action: z.literal("retry"), ids: Ids }),
]);

export const POST = handle(async (req) => {
  requireSession(req);
  const a = await readJson(req, Action);
  switch (a.action) {
    case "reorder":
      if (a.albumId && !getAlbum(a.albumId)) throw new ApiError(404, "Album not found");
      try {
        moveItems(a.ids, a.albumId, a.prevId);
      } catch (e) {
        throw new ApiError(409, (e as Error).message);
      }
      break;
    case "move":
      if (a.albumId && !getAlbum(a.albumId)) throw new ApiError(404, "Album not found");
      moveToAlbum(a.ids, a.albumId);
      break;
    case "favorite":
      setFavorite(a.ids, a.value);
      break;
    case "trash":
      trashItems(a.ids);
      break;
    case "restore":
      restoreItems(a.ids);
      break;
    case "purge":
      await purgeItems(a.ids);
      break;
    case "retry":
      a.ids.forEach(retryItem);
      break;
  }
  return json({ ok: true });
});
