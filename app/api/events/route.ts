import { COOKIE_NAME } from "@/lib/server/config";
import { requireSession, sessionFromToken } from "@/lib/server/auth";
import { subscribe, type VaultEvent } from "@/lib/server/events";
import { handle } from "@/lib/server/http";
import { getItems, toDTO } from "@/lib/server/media";

export const dynamic = "force-dynamic";

/** Server-sent events: live updates for uploads, processing progress, edits from other tabs. */
export const GET = handle(async (req) => {
  requireSession(req);
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (data: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {}
      };
      const unsub = subscribe((e: VaultEvent) => {
        try {
          if (e.type === "item.upsert") send({ type: "items", items: getItems(e.ids).map(toDTO) });
          else send(e);
          if (e.type === "vault.sealed") close();
        } catch {}
      });
      const ping = setInterval(() => {
        // Stop streaming the moment the session expires or is revoked.
        if (!sessionFromToken(token, { touch: false })) {
          send({ type: "session.ended" });
          return close();
        }
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 20_000);
      req.signal.addEventListener("abort", close);
      cleanup = close;
      send({ type: "hello" });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
});
