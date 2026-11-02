import { z } from "zod";
import { COOKIE_NAME } from "@/lib/server/config";
import {
  clientIp,
  createSession,
  logLogin,
  recordFailure,
  recordSuccess,
  setSessionCookie,
  throttleRemaining,
} from "@/lib/server/auth";
import { sha256Hex } from "@/lib/server/crypto";
import { db, getMeta, setMeta } from "@/lib/server/db";
import { ApiError, assertSameOrigin, handle, json, readJson } from "@/lib/server/http";
import { isInitialized, openSecret, unlock } from "@/lib/server/keyring";
import { verifyTotp } from "@/lib/server/totp";

const Body = z.object({
  passphrase: z.string().min(1).max(1024),
  code: z.string().max(12).optional(),
});

const jitter = () => new Promise((r) => setTimeout(r, 150 + Math.random() * 250));

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (!isInitialized()) throw new ApiError(409, "Vault is not set up yet");

  const ip = clientIp(req);
  const wait = throttleRemaining(ip);
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    return json({ error: `Too many attempts. Try again in ${secs}s.`, retryAfter: secs }, { status: 429, headers: { "Retry-After": String(secs) } });
  }

  const body = await readJson(req, Body);
  const sealedTotp = getMeta("totp_secret");
  let usedCounter: number | null = null;

  const result = await unlock(
    body.passphrase,
    sealedTotp
      ? (mk) => {
          const secret = openSecret(sealedTotp, "totp", mk);
          if (!secret) return false;
          usedCounter = verifyTotp(secret, body.code ?? "", Date.now(), Number(getMeta("totp_last") ?? -1));
          secret.fill(0);
          return usedCounter !== null;
        }
      : undefined,
  );

  if (result !== "ok") {
    recordFailure(ip);
    logLogin(req, false, result);
    await jitter();
    return json({ error: sealedTotp ? "Wrong passphrase or code" : "Wrong passphrase" }, { status: 401 });
  }

  if (usedCounter !== null) setMeta("totp_last", String(usedCounter)); // codes are single-use
  recordSuccess(ip);
  logLogin(req, true);

  // Never reuse a pre-existing session id.
  const previous = req.cookies.get(COOKIE_NAME)?.value;
  if (previous) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(sha256Hex(previous));
  }
  const { token, expiresAt } = createSession(req);
  const res = json({ ok: true });
  setSessionCookie(res, token, expiresAt);
  return res;
});
