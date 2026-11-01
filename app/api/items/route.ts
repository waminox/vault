import { requireSession } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { getItems, listItems, toDTO } from "@/lib/server/media";
import { ListQuerySchema, Uuid } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  requireSession(req);
  const sp = req.nextUrl.searchParams;
  const ids = sp.get("ids");
  if (ids) {
    const list = ids.split(",").slice(0, 500).filter((id) => Uuid.safeParse(id).success);
    return json({ items: getItems(list).map(toDTO) });
  }
  const q = ListQuerySchema.parse(Object.fromEntries(sp));
  return json(listItems(q));
});
