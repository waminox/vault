"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface Prefs {
  /** Thumbnails start blurred on every visit (the original vault's default). */
  blurOnLoad: boolean;
  /** Hovering a blurred tile reveals just that tile. */
  peekOnHover: boolean;
  /** Cover the screen when the window loses focus (alt-tab, screen share previews). */
  shieldOnBlur: boolean;
  /** Lock after this many idle minutes (0 = never). */
  autoLockMinutes: number;
  /** Triple-Esc locks and leaves the page. */
  panicKey: boolean;
  /** Grid tile size in px. */
  tile: number;
  /** Play muted previews when hovering video tiles. */
  hoverPreview: boolean;
  slideshowSeconds: number;
}

const DEFAULTS: Prefs = {
  blurOnLoad: true,
  peekOnHover: true,
  shieldOnBlur: true,
  autoLockMinutes: 15,
  panicKey: true,
  tile: 200,
  hoverPreview: true,
  slideshowSeconds: 4,
};

const KEY = "vault:prefs";
let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function getPrefs(): Prefs {
  return typeof window === "undefined" ? DEFAULTS : read();
}

export function setPrefs(patch: Partial<Prefs>): void {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULTS,
  );
  return [prefs, useCallback(setPrefs, [])];
}

/** Small typed localStorage helpers for per-item state (playback position etc.). */
export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
