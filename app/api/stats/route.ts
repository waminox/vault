import { requireSession } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { handle, json } from "@/lib/server/http";
import { stats } from "@/lib/server/media";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  requireSession(req);
  return json({
    stats: stats(),
    server: {
      ffmpeg: !!config.media.ffmpeg,
      maxUploadBytes: config.maxUploadBytes,
      trashDays: config.trashDays,
      sessionIdleMs: config.sessionIdleMs,
    },
  });
});
