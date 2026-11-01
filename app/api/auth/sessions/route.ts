import { requireSession } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { ApiError, handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const me = requireSession(req);
  const now = Date.now();
  const sessions = db()
    .prepare("SELECT * FROM sessions WHERE expires_at > ? AND last_seen_at > ? ORDER BY last_seen_at DESC")
    .all(now, now - config.sessionIdleMs) as { id: string; created_at: number; last_seen_at: number; ip: string; user_agent: string }[];
  const events = db().prepare("SELECT * FROM login_events ORDER BY id DESC LIMIT 40").all();
  return json({
    sessions: sessions.map((s) => ({
      // Never expose the session hash itself; a prefix is enough to address it.
      id: s.id.slice(0, 16),
      current: s.id === me.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      ip: s.ip,
      userAgent: s.user_agent,
    })),
    events,
  });
});

export const DELETE = handle(async (req) => {
  const me = requireSession(req);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) throw new ApiError(400, "Bad id");
  if (me.id.startsWith(id)) throw new ApiError(400, "Use Lock to end your own session");
  db().prepare("DELETE FROM sessions WHERE substr(id, 1, 16) = ?").run(id);
  return json({ ok: true });
});
