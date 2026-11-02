import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";
import { completeUpload } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  meta: z.object({ duration: z.number().optional(), width: z.number().optional(), height: z.number().optional() }).optional(),
});

export const POST = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const { meta } = await readJson(req, Body);
  return json({ item: await completeUpload((await params).id, meta) }, { status: 202 });
});
