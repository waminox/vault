import { requireSession } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { ApiError, contentDisposition, handle, parseRange } from "@/lib/server/http";
import { getItem, parseVariants } from "@/lib/server/media";
import { Uuid } from "@/lib/server/schemas";
import { openBlobReader } from "@/lib/server/storage";
import type { Variant, Variants } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; variant: string }> };

/** Logical variants map to stored ones with fallbacks. */
function pick(v: Variants, name: string): { variant: Variant; derived: boolean } | null {
  const order: Record<string, (keyof Variants)[]> = {
    thumb: ["thumb", "poster", "preview"],
    preview: ["preview", "original"],
    poster: ["poster", "preview", "thumb"],
    stream: ["playback", "original"],
    original: ["original"],
    storyboard: ["storyboard"],
  };
  for (const key of order[name] ?? []) {
    const variant = v[key];
    if (variant) return { variant, derived: key !== "original" && key !== "playback" };
  }
  return null;
}

const EXT: Record<string, string> = { "image/webp": "webp", "video/mp4": "mp4" };

export const GET = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const { id, variant: name } = await params;
  const item = getItem(Uuid.parse(id));
  if (!item) throw new ApiError(404, "Not found");
  const picked = pick(parseVariants(item), name);
  if (!picked) throw new ApiError(404, "Variant not available");
  const { variant, derived } = picked;

  const etag = `"${variant.blob}"`;
  const cacheable = derived && config.thumbCacheSeconds > 0;
  const headers = new Headers({
    "Content-Type": variant.mime,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": cacheable ? `private, max-age=${config.thumbCacheSeconds}, immutable` : "no-store",
    "X-Content-Type-Options": "nosniff",
    // Even if someone opens a media URL directly, nothing in it can run.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  });

  if (cacheable && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const download = req.nextUrl.searchParams.get("download") === "1";
  let filename = item.name;
  if (variant.mime !== item.mime && EXT[variant.mime]) filename = `${item.name.replace(/\.[^.]+$/, "")}.${EXT[variant.mime]}`;
  headers.set("Content-Disposition", contentDisposition(download ? "attachment" : "inline", filename));

  const reader = await openBlobReader(variant.blob);
  const range = parseRange(req.headers.get("range"), reader.size);
  if (range === "invalid") {
    await reader.close();
    headers.set("Content-Range", `bytes */${reader.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? reader.size - 1;
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${reader.size}`);

  const it = reader.read(start, end);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) {
          await reader.close();
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        }
      } catch (err) {
        await reader.close();
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
      await reader.close();
    },
  });
  return new Response(reader.size === 0 ? null : body, { status: range ? 206 : 200, headers });
});
