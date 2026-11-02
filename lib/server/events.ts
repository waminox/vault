import { EventEmitter } from "node:events";

export type VaultEvent =
  | { type: "item.upsert"; ids: string[] }
  | { type: "item.removed"; ids: string[] }
  | { type: "item.progress"; id: string; progress: number }
  | { type: "item.duplicate"; id: string; of: string; name: string }
  | { type: "albums.changed" }
  | { type: "vault.sealed" };

const g = globalThis as unknown as { __vaultBus?: EventEmitter };
const bus = (g.__vaultBus ??= new EventEmitter().setMaxListeners(1000));

export function publish(event: VaultEvent): void {
  bus.emit("event", event);
}

export function subscribe(fn: (e: VaultEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

/** Internal lifecycle signals (not sent to browsers). */
export function onUnsealed(fn: () => void): () => void {
  bus.on("unsealed", fn);
  return () => bus.off("unsealed", fn);
}

export function emitUnsealed(): void {
  bus.emit("unsealed");
}
