import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";
import { Uuid } from "@/lib/server/schemas";
import { createUpload } from "@/lib/server/uploads";

const Body = z.object({
  name: z.string().min(1).max(1000),
  size: z.number().int().positive(),
  albumId: Uuid.nullable().default(null),
  lastModified: z.number().int().positive().optional(),
  resumeId: z.string().max(64).optional(),
});

export const POST = handle(async (req) => {
  requireSession(req);
  const body = await readJson(req, Body);
  return json(await createUpload(body), { status: 201 });
});
