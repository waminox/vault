import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { VaultSealedError } from "./keyring";

export class ApiError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

/** Wrap a route handler with uniform error handling. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message, ...err.extra }, { status: err.status });
      if (err instanceof VaultSealedError) return json({ error: "Vault is locked", sealed: true }, { status: 401 });
      if (err instanceof z.ZodError) {
        return json({ error: "Invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      }
      console.error("[vault] unhandled error", err);
      return json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Expected a JSON body");
  }
  return schema.parse(body);
}

/**
 * CSRF defence in depth (cookies are already SameSite=Strict): state-changing
 * requests coming from a browser must be same-origin.
 */
export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new ApiError(403, "Cross-site request blocked");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ApiError(403, "Bad origin");
    }
    if (!host || originHost !== host) throw new ApiError(403, "Cross-origin request blocked");
  }
}

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

/** Parse a single-range `Range` header. Returns null for "whole file", "invalid" for 416. */
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or garbage: serve the full body
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
