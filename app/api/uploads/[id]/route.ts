import { requireSession } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { abortUpload, status } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  return json(status((await params).id));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  await abortUpload((await params).id);
  return json({ ok: true });
});
