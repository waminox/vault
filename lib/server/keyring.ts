import crypto from "node:crypto";
import { config } from "./config";
import { deriveKek, newKdfParams, openBytes, sealBytes, type KdfParams } from "./crypto";
import { getMeta, setMeta, tx } from "./db";
import { emitUnsealed, publish } from "./events";

/**
 * The vault is "sealed" until someone logs in: the master key exists only as a
 * passphrase-wrapped blob in the database. Logging in unwraps it into memory;
 * when the last session ends it is zeroed again.
 */

export class VaultSealedError extends Error {
  constructor() {
    super("Vault is sealed");
  }
}

const g = globalThis as unknown as { __vaultKey?: Buffer };

export function isInitialized(): boolean {
  return getMeta("wrapped_key") !== undefined;
}

export function isUnsealed(): boolean {
  return !!g.__vaultKey;
}

export function masterKey(): Buffer {
  if (!g.__vaultKey) throw new VaultSealedError();
  return g.__vaultKey;
}

export function seal(): void {
  if (!g.__vaultKey) return;
  g.__vaultKey.fill(0);
  g.__vaultKey = undefined;
  publish({ type: "vault.sealed" });
}

function kdf(): KdfParams {
  const raw = getMeta("kdf");
  if (!raw) throw new Error("Vault is not initialized");
  return JSON.parse(raw) as KdfParams;
}

export function validatePassphrase(p: string): string | null {
  if (typeof p !== "string") return "Passphrase required";
  if (p.length < 10) return "Use at least 10 characters (a few random words work great)";
  if (p.length > 1024) return "Passphrase too long";
  return null;
}

export async function initVault(passphrase: string): Promise<void> {
  const problem = validatePassphrase(passphrase);
  if (problem) throw new Error(problem);
  if (isInitialized()) throw new Error("Vault already initialized");
  const params = newKdfParams(config.kdfLogN);
  const kek = await deriveKek(passphrase, params);
  const mk = crypto.randomBytes(32);
  tx(() => {
    if (getMeta("wrapped_key")) throw new Error("Vault already initialized");
    setMeta("kdf", JSON.stringify(params));
    setMeta("wrapped_key", sealBytes(mk, kek));
    setMeta("created_at", String(Date.now()));
  });
  kek.fill(0);
  mk.fill(0);
}

/** Returns the unwrapped master key, or null if the passphrase is wrong. */
async function unwrap(passphrase: string): Promise<Buffer | null> {
  const wrapped = getMeta("wrapped_key");
  if (!wrapped) return null;
  const kek = await deriveKek(passphrase, kdf());
  const mk = openBytes(wrapped, kek);
  kek.fill(0);
  return mk;
}

/**
 * Verify the passphrase and, if correct (and the optional second factor check
 * passes), unseal the vault.
 */
export async function unlock(
  passphrase: string,
  secondFactor?: (mk: Buffer) => boolean,
): Promise<"ok" | "bad-passphrase" | "bad-second-factor"> {
  const mk = await unwrap(passphrase);
  if (!mk) return "bad-passphrase";
  if (secondFactor && !secondFactor(mk)) {
    mk.fill(0);
    return "bad-second-factor";
  }
  if (g.__vaultKey) {
    mk.fill(0);
  } else {
    g.__vaultKey = mk;
    emitUnsealed();
  }
  return "ok";
}

export async function verifyPassphrase(passphrase: string): Promise<boolean> {
  const mk = await unwrap(passphrase);
  if (!mk) return false;
  mk.fill(0);
  return true;
}

export async function changePassphrase(current: string, next: string): Promise<boolean> {
  const problem = validatePassphrase(next);
  if (problem) throw new Error(problem);
  const mk = await unwrap(current);
  if (!mk) return false;
  const params = newKdfParams(config.kdfLogN);
  const kek = await deriveKek(next, params);
  tx(() => {
    setMeta("kdf", JSON.stringify(params));
    setMeta("wrapped_key", sealBytes(mk, kek));
  });
  kek.fill(0);
  mk.fill(0);
  return true;
}

/** Encrypt a small secret (e.g. the TOTP seed) under the master key. */
export function sealSecret(plain: Buffer, label: string): string {
  return sealBytes(plain, masterKey(), Buffer.from(`vault/secret/${label}`));
}

export function openSecret(sealed: string, label: string, key: Buffer = masterKey()): Buffer | null {
  return openBytes(sealed, key, Buffer.from(`vault/secret/${label}`));
}
