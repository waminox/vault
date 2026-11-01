import { COOKIE_NAME, config } from "@/lib/server/config";
import { sessionFromToken, totpEnabled } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { isInitialized, isUnsealed } from "@/lib/server/keyring";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const session = sessionFromToken(req.cookies.get(COOKIE_NAME)?.value);
  return json({
    initialized: isInitialized(),
    totp: totpEnabled(),
    unsealed: isUnsealed(),
    signedIn: !!session,
    idleTimeoutMs: config.sessionIdleMs,
  });
});
