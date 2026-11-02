/**
 * Identify uploads by their magic bytes. The browser-supplied MIME type and the
 * file extension are never trusted (that is exactly how the old PHP upload
 * handler got a webshell planted).
 */

export interface Sniffed {
  kind: "image" | "video";
  mime: string;
  ext: string;
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniff(head: Uint8Array): Sniffed | null {
  if (head.length < 12) return null;

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mime: "image/png", ext: "png" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { kind: "image", mime: "image/gif", ext: "gif" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: "image", mime: "image/tiff", ext: "tiff" };
  }

  // ISO base media (MP4, MOV, 3GP, AVIF, HEIC): [size]["ftyp"][brand]
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    // Look at compatible brands too (some encoders lead with a generic brand).
    const boxSize = Math.min(head.length, (head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]);
    const brands = [brand];
    for (let o = 16; o + 4 <= boxSize; o += 4) brands.push(ascii(head, o, 4));
    if (brands.includes("avif") || brands.includes("avis")) return { kind: "image", mime: "image/avif", ext: "avif" };
    if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) return { kind: "image", mime: "image/heic", ext: "heic" };
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    if (brand.startsWith("3g")) return { kind: "video", mime: "video/3gpp", ext: "3gp" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }

  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const probe = ascii(head, 0, Math.min(head.length, 64));
    return probe.includes("webm")
      ? { kind: "video", mime: "video/webm", ext: "webm" }
      : { kind: "video", mime: "video/x-matroska", ext: "mkv" };
  }
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "AVI ") return { kind: "video", mime: "video/x-msvideo", ext: "avi" };
  if (startsWith(head, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return { kind: "video", mime: "video/x-ms-wmv", ext: "wmv" };
  if (ascii(head, 0, 3) === "FLV") return { kind: "video", mime: "video/x-flv", ext: "flv" };
  if (startsWith(head, [0x00, 0x00, 0x01, 0xba]) || startsWith(head, [0x00, 0x00, 0x01, 0xb3])) {
    return { kind: "video", mime: "video/mpeg", ext: "mpg" };
  }
  if (head[0] === 0x47 && head.length > 188 && head[188] === 0x47) return { kind: "video", mime: "video/mp2t", ext: "ts" };
  if (ascii(head, 0, 4) === "OggS") return { kind: "video", mime: "video/ogg", ext: "ogv" };

  return null;
}

/** Formats every modern browser can play natively without transcoding. */
export const BROWSER_PLAYABLE_CONTAINERS = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
export const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/** Images the browser can display directly at full resolution. */
export const BROWSER_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
