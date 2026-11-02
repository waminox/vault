import QRCode from "qrcode";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { getMeta, setMeta } from "@/lib/server/db";
import { ApiError, handle, json, readJson } from "@/lib/server/http";
import { openSecret, sealSecret, verifyPassphrase } from "@/lib/server/keyring";
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/server/totp";

/** Begin enrollment: create a pending secret and return its QR code. */
export const GET = handle(async (req) => {
  requireSession(req);
  if (getMeta("totp_secret")) return json({ enabled: true });
  const secret = newTotpSecret();
  setMeta("totp_pending", sealSecret(secret, "totp-pending"));
  const uri = otpauthUri(secret, "My vault", "Vault");
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: "#0b0b12", light: "#ffffff" } });
  return json({ enabled: false, secret: base32Encode(secret), uri, qr });
});

const Enable = z.object({ code: z.string().max(12) });

export const POST = handle(async (req) => {
  requireSession(req);
  const { code } = await readJson(req, Enable);
  const pending = getMeta("totp_pending");
  if (!pending) throw new ApiError(400, "Start enrollment first");
  const secret = openSecret(pending, "totp-pending");
  if (!secret) throw new ApiError(400, "Enrollment expired, start again");
  const counter = verifyTotp(secret, code);
  if (counter === null) throw new ApiError(400, "That code didn't match. Check your phone's clock and try again.");
  setMeta("totp_secret", sealSecret(secret, "totp"));
  setMeta("totp_last", String(counter));
  setMeta("totp_pending", null);
  secret.fill(0);
  return json({ enabled: true });
});

const Disable = z.object({ passphrase: z.string().min(1).max(1024), code: z.string().max(12) });

export const DELETE = handle(async (req) => {
  requireSession(req);
  const body = await readJson(req, Disable);
  const sealed = getMeta("totp_secret");
  if (!sealed) return json({ enabled: false });
  const secret = openSecret(sealed, "totp");
  const okCode = secret && verifyTotp(secret, body.code, Date.now(), Number(getMeta("totp_last") ?? -1)) !== null;
  secret?.fill(0);
  if (!okCode || !(await verifyPassphrase(body.passphrase))) throw new ApiError(401, "Passphrase or code is wrong");
  setMeta("totp_secret", null);
  setMeta("totp_last", null);
  return json({ enabled: false });
});
