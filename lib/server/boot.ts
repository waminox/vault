import { sweepSessions } from "./auth";
import { config } from "./config";
import { randomToken } from "./crypto";
import { db } from "./db";
import { onUnsealed } from "./events";
import { isInitialized } from "./keyring";
import { purgeExpiredTrash } from "./media";
import { kick, recoverJobs } from "./processing";
import { cleanupExpiredUploads } from "./uploads";

const g = globalThis as unknown as { __vaultBooted?: boolean; __vaultSetupToken?: string };

export function setupToken(): string | undefined {
  return g.__vaultSetupToken;
}

export function clearSetupToken(): void {
  g.__vaultSetupToken = undefined;
}

export function boot(): void {
  if (g.__vaultBooted) return;
  g.__vaultBooted = true;

  db();
  recoverJobs();
  onUnsealed(kick);

  const { ffmpeg } = config.media;
  console.log(`[vault] data dir: ${config.dataDir}`);
  console.log(`[vault] ffmpeg: ${ffmpeg ? "available — videos are converted & get scrub previews" : "not found — videos are stored as-is"}`);

  if (!isInitialized()) {
    g.__vaultSetupToken = randomToken(18);
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    console.log("\n  ┌───────────────────────────────────────────────────────────────┐");
    console.log("  │  Vault is not initialized yet. Finish setup in your browser:  │");
    console.log("  └───────────────────────────────────────────────────────────────┘");
    console.log(`     ${base}/setup?token=${g.__vaultSetupToken}\n`);
    console.log("     (or run `npm run vault:init` on the server)\n");
  }

  let tick = 0;
  const timer = setInterval(async () => {
    tick++;
    try {
      sweepSessions();
      if (tick % 10 === 0) await cleanupExpiredUploads();
      if (tick % 60 === 1) await purgeExpiredTrash();
    } catch (err) {
      console.error("[vault] maintenance failed", err);
    }
  }, 60_000);
  timer.unref();
}
