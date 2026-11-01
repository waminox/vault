import { z } from "zod";
import { createSession, setSessionCookie } from "@/lib/server/auth";
import { clearSetupToken, setupToken } from "@/lib/server/boot";
import { timingSafeEqualStr } from "@/lib/server/crypto";
import { ApiError, assertSameOrigin, handle, json, readJson } from "@/lib/server/http";
import { initVault, isInitialized, unlock, validatePassphrase } from "@/lib/server/keyring";

const Body = z.object({ token: z.string().min(1).max(100), passphrase: z.string().max(1024) });

/** First-run setup, gated by a one-time token printed to the server console. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (isInitialized()) throw new ApiError(409, "Vault is already set up");
  const body = await readJson(req, Body);
  const expected = setupToken();
  if (!expected || !timingSafeEqualStr(body.token, expected)) throw new ApiError(403, "Invalid setup token — check the server log");
  const problem = validatePassphrase(body.passphrase);
  if (problem) throw new ApiError(400, problem);
  await initVault(body.passphrase);
  clearSetupToken();
  await unlock(body.passphrase);
  const { token, expiresAt } = createSession(req);
  const res = json({ ok: true });
  setSessionCookie(res, token, expiresAt);
  return res;
});
