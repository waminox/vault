import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/server/http";
import { sniff } from "@/lib/server/sniff";
import { base32Decode, base32Encode, hotp, verifyTotp } from "@/lib/server/totp";
import { sanitizeName } from "@/lib/server/uploads";

describe("TOTP (RFC 4226 / 6238 vectors)", () => {
  const secret = Buffer.from("12345678901234567890");

  it("matches the RFC 4226 HOTP test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(secret, i)).toBe(code));
  });

  it("matches RFC 6238 SHA-1 vectors (6-digit truncation)", () => {
    // 59s → 94287082, 1111111109s → 07081804 (last 6 digits)
    expect(verifyTotp(secret, "287082", 59_000)).not.toBeNull();
    expect(verifyTotp(secret, "081804", 1111111109_000)).not.toBeNull();
  });

  it("refuses replays and junk", () => {
    const counter = verifyTotp(secret, "287082", 59_000)!;
    expect(verifyTotp(secret, "287082", 59_000, counter)).toBeNull();
    expect(verifyTotp(secret, "abc", 59_000)).toBeNull();
    expect(verifyTotp(secret, "", 59_000)).toBeNull();
  });

  it("base32 round-trips", () => {
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });
});

describe("Range header parsing", () => {
  it("handles the common forms", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});

describe("magic-byte sniffing", () => {
  const pad = (b: number[]) => Uint8Array.from([...b, ...new Array(64).fill(0)]);
  const ftyp = (brand: string) => pad([0, 0, 0, 0x18, ...Buffer.from("ftyp"), ...Buffer.from(brand)]);

  it("identifies images and videos", () => {
    expect(sniff(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(sniff(pad([...Buffer.from("GIF89a")]))?.mime).toBe("image/gif");
    expect(sniff(ftyp("isom"))?.mime).toBe("video/mp4");
    expect(sniff(ftyp("qt  "))?.mime).toBe("video/quicktime");
    expect(sniff(ftyp("heic"))?.mime).toBe("image/heic");
    expect(sniff(ftyp("avif"))?.mime).toBe("image/avif");
    expect(sniff(pad([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("....webm")]))?.mime).toBe("video/webm");
  });

  it("rejects scripts disguised as images", () => {
    expect(sniff(pad([...Buffer.from("<?php system($_GET['c']); ?>")]))).toBeNull();
    expect(sniff(pad([...Buffer.from("<svg onload=alert(1)>")]))).toBeNull();
    expect(sniff(pad([...Buffer.from("<html><script>")]))).toBeNull();
  });
});

describe("filename sanitizing", () => {
  it("strips paths, control and bidi characters", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeName("evil\u202Egpj.php")).toBe("evilgpj.php");
    expect(sanitizeName("   ")).toBe("untitled");
  });
});
