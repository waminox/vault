import crypto from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with every authenticator app. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

/**
 * Returns the matched time-step counter (for replay protection) or null.
 * Accepts ±1 step of clock drift.
 */
export function verifyTotp(secret: Buffer, code: string, now = Date.now(), lastUsedCounter = -1): number | null {
  const clean = (code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const t = Math.floor(now / 1000 / 30);
  for (const c of [t, t - 1, t + 1]) {
    if (c <= lastUsedCounter) continue;
    const expected = hotp(secret, c);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return c;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return crypto.randomBytes(20);
}

export function otpauthUri(secret: Buffer, label = "Vault", issuer = "Vault"): string {
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params}`;
}
