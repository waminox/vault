import { spawn } from "node:child_process";
import { config } from "./config";

export interface Probe {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
  createdAt: number | null;
}

function run(bin: string, args: string[], onStdout?: (line: string) => void, timeoutMs = 6 * 3600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let buf = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (onStdout) {
        buf += s;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(onStdout);
      } else out += s;
    });
    p.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited with ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

export function hasFfmpeg(): boolean {
  return !!config.media.ffmpeg && !!config.media.ffprobe;
}

export async function probe(file: string): Promise<Probe | null> {
  const ffprobe = config.media.ffprobe;
  if (!ffprobe) return null;
  const raw = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], undefined, 60_000);
  const data = JSON.parse(raw) as {
    format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
    streams?: {
      codec_type: string;
      codec_name?: string;
      width?: number;
      height?: number;
      tags?: Record<string, string>;
      side_data_list?: { rotation?: number }[];
      disposition?: { attached_pic?: number };
    }[];
  };
  const v = data.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const rotation = Number(v?.side_data_list?.find((sd) => sd.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  const swap = Math.abs(rotation) % 180 === 90;
  const created = data.format?.tags?.creation_time ? Date.parse(data.format.tags.creation_time) : NaN;
  const duration = Number(data.format?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: (swap ? v?.height : v?.width) ?? null,
    height: (swap ? v?.width : v?.height) ?? null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    formatName: data.format?.format_name ?? null,
    createdAt: Number.isFinite(created) && created > 0 ? created : null,
  };
}

/** Grab a single frame as JPEG. */
export async function extractFrame(input: string, atSeconds: number, output: string): Promise<void> {
  const ffmpeg = config.media.ffmpeg!;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", atSeconds.toFixed(2), "-i", input, "-frames:v", "1", "-q:v", "2", output];
  try {
    await run(ffmpeg, args, undefined, 120_000);
  } catch {
    // Seeking past a short clip's end: fall back to the first frame.
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-frames:v", "1", "-q:v", "2", output], undefined, 120_000);
  }
}

/** Transcode to universally playable H.264/AAC MP4 with the moov atom up front. */
export async function transcodeToMp4(input: string, output: string, duration: number | null, onProgress: (p: number) => void): Promise<void> {
  const ffmpeg = config.media.ffmpeg!;
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    // A keyframe every 2 s keeps browser seeking snappy and storyboards cheap.
    "-force_key_frames", "expr:gte(t,n_forced*2)",
    "-vf", "scale='min(1920,iw)':-2:flags=lanczos",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    output,
  ];
  await run(ffmpeg, args, (line) => {
    const m = /^out_time_(?:ms|us)=(\d+)/.exec(line);
    if (m && duration) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration));
  });
}

/**
 * Extract up to `count` evenly spaced frames (as JPEGs in `dir`) for scrub previews.
 * Long videos decode keyframes only, which is an order of magnitude faster.
 */
export async function storyboardFrames(input: string, dir: string, interval: number, count: number, tileW: number, duration: number): Promise<string[]> {
  const ffmpeg = config.media.ffmpeg!;
  const fast = duration > 90 ? ["-skip_frame", "nokey"] : [];
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    ...fast, "-i", input,
    "-an", "-sn",
    "-vf", `fps=1/${interval.toFixed(3)},scale=${tileW}:-2`,
    "-frames:v", String(count), "-q:v", "5",
    `${dir}/sb_%03d.jpg`,
  ], undefined, 3600_000);
  const fs = await import("node:fs/promises");
  return (await fs.readdir(dir)).filter((f) => /^sb_\d+\.jpg$/.test(f)).sort().map((f) => `${dir}/${f}`);
}
