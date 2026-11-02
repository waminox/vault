import { requireSession } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { writePoster } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  await writePoster((await params).id, req.body);
  return json({ ok: true });
});
