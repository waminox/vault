import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, config } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import { db, getMeta } from "./db";
import { isUnsealed, seal } from "./keyring";
import { ApiError, assertSameOrigin } from "./http";

export interface Session {
  id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
}

// ─── Client identification ───────────────────────────────────────────────────

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // Behind a trusted reverse proxy the left-most hop is the real client;
    // otherwise only the hop appended by our own server can be trusted.
    const hop = config.trustProxy ? hops[0] : hops[hops.length - 1];
    if (hop) return hop.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

function userAgent(req: Request): string {
  return (req.headers.get("user-agent") ?? "").slice(0, 300);
}

// ─── Brute-force throttling ──────────────────────────────────────────────────

interface Strike {
  fails: number;
  until: number;
  lastFail: number;
}
const g = globalThis as unknown as { __vaultStrikes?: Map<string, Strike> };
const strikes = (g.__vaultStrikes ??= new Map());
const FREE_ATTEMPTS = 5;
const MAX_LOCK_MS = 15 * 60_000;

function strikeKeys(ip: string): string[] {
  return [`ip:${ip}`, "global"];
}

/** Returns ms until the next attempt is allowed (0 = go ahead). */
export function throttleRemaining(ip: string, now = Date.now()): number {
  let wait = 0;
  for (const k of strikeKeys(ip)) {
    const s = strikes.get(k);
    if (s && s.until > now) wait = Math.max(wait, s.until - now);
  }
  return wait;
}

export function recordFailure(ip: string, now = Date.now()): void {
  for (const k of strikeKeys(ip)) {
    const free = k === "global" ? FREE_ATTEMPTS * 4 : FREE_ATTEMPTS;
    const s = strikes.get(k) ?? { fails: 0, until: 0, lastFail: 0 };
    // Forget old failures after a quiet hour.
    if (now - s.lastFail > 3600_000) s.fails = 0;
    s.fails++;
    s.lastFail = now;
    if (s.fails >= free) s.until = now + Math.min(MAX_LOCK_MS, 15_000 * 2 ** (s.fails - free));
    strikes.set(k, s);
  }
}

export function recordSuccess(ip: string): void {
  strikes.delete(`ip:${ip}`);
}

export function logLogin(req: Request, success: boolean, reason?: string): void {
  db()
    .prepare("INSERT INTO login_events(at, ip, user_agent, success, reason) VALUES(?, ?, ?, ?, ?)")
    .run(Date.now(), clientIp(req), userAgent(req), success ? 1 : 0, reason ?? null);
  db().prepare("DELETE FROM login_events WHERE id <= (SELECT MAX(id) - 500 FROM login_events)").run();
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function createSession(req: Request): { token: string; expiresAt: number } {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + config.sessionMaxMs;
  db()
    .prepare("INSERT INTO sessions(id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES(?, ?, ?, ?, ?, ?)")
    .run(sha256Hex(token), now, now, expiresAt, clientIp(req), userAgent(req));
  return { token, expiresAt };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: number): void {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
    priority: "high",
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: config.cookieSecure, sameSite: "strict", path: "/", maxAge: 0 });
}

export function sessionFromToken(token: string | undefined, { touch = true } = {}): Session | null {
  if (!token || token.length > 100) return null;
  // A sealed vault means the server restarted or every session ended: nothing is valid.
  if (!isUnsealed()) return null;
  const id = sha256Hex(token);
  const row = db().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now || row.last_seen_at + config.sessionIdleMs <= now) {
    destroySession(row.id);
    return null;
  }
  if (touch && now - row.last_seen_at > 30_000) {
    db().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, row.id);
    row.last_seen_at = now;
  }
  return row;
}

/** For server components / pages. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return sessionFromToken(jar.get(COOKIE_NAME)?.value);
}

/** For API routes: authenticate + CSRF check, or throw 401/403. */
export function requireSession(req: NextRequest): Session {
  assertSameOrigin(req);
  const s = sessionFromToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!s) throw new ApiError(401, isUnsealed() ? "Not signed in" : "Vault is locked", { sealed: !isUnsealed() });
  return s;
}

export function activeSessionCount(now = Date.now()): number {
  const r = db()
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ? AND last_seen_at > ?")
    .get(now, now - config.sessionIdleMs) as { n: number };
  return r.n;
}

export function destroySession(id: string): void {
  db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  if (activeSessionCount() === 0) seal();
}

export function destroyAllSessions(): void {
  db().prepare("DELETE FROM sessions").run();
  seal();
}

/** Periodic sweep: drop expired sessions and seal the vault once nobody is signed in. */
export function sweepSessions(): void {
  const now = Date.now();
  db().prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(now, now - config.sessionIdleMs);
  if (isUnsealed() && activeSessionCount(now) === 0) seal();
}

export function totpEnabled(): boolean {
  return !!getMeta("totp_secret");
}
