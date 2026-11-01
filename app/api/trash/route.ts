import { requireSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { purgeItems } from "@/lib/server/media";

/** Empty the trash: shred every trashed item for good. */
export const DELETE = handle(async (req) => {
  requireSession(req);
  const ids = (db().prepare("SELECT id FROM items WHERE deleted_at IS NOT NULL").all() as { id: string }[]).map((r) => r.id);
  await purgeItems(ids);
  return json({ purged: ids.length });
});
