import { z } from "zod";
import { COOKIE_NAME } from "@/lib/server/config";
import { clearSessionCookie, destroyAllSessions, destroySession, sessionFromToken } from "@/lib/server/auth";
import { sha256Hex } from "@/lib/server/crypto";
import { assertSameOrigin, handle, json } from "@/lib/server/http";

const Body = z.object({ everywhere: z.boolean().optional() }).optional();

/** Lock: end this session (or every session). The last one out seals the vault. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const token = req.cookies.get(COOKIE_NAME)?.value;
  let everywhere = false;
  try {
    everywhere = !!Body.parse(await req.json())?.everywhere;
  } catch {}
  if (everywhere && sessionFromToken(token)) destroyAllSessions();
  else if (token) destroySession(sha256Hex(token));
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
});
