import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { ApiError, handle, json, readJson } from "@/lib/server/http";
import { changePassphrase, validatePassphrase } from "@/lib/server/keyring";

const Body = z.object({ current: z.string().min(1).max(1024), next: z.string().max(1024) });

export const POST = handle(async (req) => {
  const session = requireSession(req);
  const body = await readJson(req, Body);
  const problem = validatePassphrase(body.next);
  if (problem) throw new ApiError(400, problem);
  const ok = await changePassphrase(body.current, body.next);
  if (!ok) throw new ApiError(401, "Current passphrase is wrong");
  // Everyone else has to sign in again with the new passphrase.
  db().prepare("DELETE FROM sessions WHERE id != ?").run(session.id);
  return json({ ok: true });
});
