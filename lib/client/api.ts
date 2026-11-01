"use client";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export class HttpError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Listener = () => void;
const lockListeners = new Set<Listener>();
/** Fires when the server says our session is gone (expired, revoked, vault sealed). */
export function onSessionLost(fn: Listener): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}
export function sessionLost(): void {
  lockListeners.forEach((fn) => fn());
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
    cache: "no-store",
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) sessionLost();
    throw new HttpError(res.status, String(data.error ?? res.statusText), data);
  }
  return data as T;
}

export function mediaUrl(item: { id: string; rev: number }, variant: "thumb" | "preview" | "poster" | "stream" | "original" | "storyboard", download = false): string {
  return `${BASE}/api/media/${item.id}/${variant}?v=${item.rev}${download ? "&download=1" : ""}`;
}
