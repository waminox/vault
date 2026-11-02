"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Download,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/client/api";
import { formatDuration } from "@/lib/client/format";
import { lsGet, lsSet } from "@/lib/client/prefs";
import type { ItemDTO } from "@/lib/types";
import { FloatingMenu, ProgressRing, Spinner, cx } from "./ui";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

interface Props {
  item: ItemDTO;
  autoPlay?: boolean;
  /** Called when playback finishes (slideshow advances). */
  onEnded?: () => void;
  /** The lightbox owns ←/→ for navigation unless the player is focused. */
  active: boolean;
}

export function VideoPlayer({ item, autoPlay = true, onEnded, active }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.duration ?? 0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [volume, setVolume] = useState(() => lsGet("vault:volume", 1));
  const [muted, setMuted] = useState(() => lsGet("vault:muted", false));
  const [speed, setSpeed] = useState(() => lsGet("vault:speed", 1));
  const [loop, setLoop] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [ripple, setRipple] = useState<{ side: "l" | "r"; key: number } | null>(null);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [speedMenu, setSpeedMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const posKey = `vault:pos:${item.id}`;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 900);
  }, []);

  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!video.current?.paused) setChrome(false);
    }, 2600);
  }, []);

  const v = () => video.current;

  const togglePlay = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
    poke();
  }, [poke]);

  const seekBy = useCallback(
    (d: number) => {
      const el = v();
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + d));
      poke();
    },
    [poke],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const setVol = useCallback((x: number) => {
    const el = v();
    const val = Math.max(0, Math.min(1, x));
    if (el) {
      el.volume = val;
      el.muted = val === 0;
    }
  }, []);

  // Apply persisted settings + resume position.
  useEffect(() => {
    const el = v();
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = speed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const el = v();
    if (!el) return;
    const onMeta = () => {
      setDuration(el.duration || item.duration || 0);
      const saved = lsGet<number>(posKey, 0);
      if (saved > 5 && saved < (el.duration || 0) - 5) {
        el.currentTime = saved;
        setResumedAt(saved);
        setTimeout(() => setResumedAt(null), 5000);
      }
    };
    const onTime = () => {
      setTime(el.currentTime);
      if (Math.floor(el.currentTime) % 5 === 0) lsSet(posKey, el.currentTime);
    };
    const onProgress = () => {
      const r: [number, number][] = [];
      for (let i = 0; i < el.buffered.length; i++) r.push([el.buffered.start(i), el.buffered.end(i)]);
      setBuffered(r);
    };
    const onPlay = () => (setPlaying(true), poke());
    const onPause = () => {
      setPlaying(false);
      setChrome(true);
      lsSet(posKey, el.currentTime);
    };
    const onEnd = () => {
      lsSet(posKey, undefined);
      if (!el.loop) onEnded?.();
    };
    const onVol = () => {
      setVolume(el.volume);
      setMuted(el.muted);
      lsSet("vault:volume", el.volume);
      lsSet("vault:muted", el.muted);
    };
    const onRate = () => {
      setSpeed(el.playbackRate);
      lsSet("vault:speed", el.playbackRate);
    };
    const onWait = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onErr = () => setError("This video can't be played in your browser.");
    const map: [string, () => void][] = [
      ["loadedmetadata", onMeta],
      ["timeupdate", onTime],
      ["progress", onProgress],
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onEnd],
      ["volumechange", onVol],
      ["ratechange", onRate],
      ["waiting", onWait],
      ["playing", onPlaying],
      ["canplay", onPlaying],
      ["error", onErr],
    ];
    map.forEach(([e, f]) => el.addEventListener(e, f));
    return () => {
      map.forEach(([e, f]) => el.removeEventListener(e, f));
      if (el.currentTime > 5 && el.currentTime < (el.duration || 0) - 5) lsSet(posKey, el.currentTime);
    };
  }, [item.id, item.duration, onEnded, poke, posKey]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Keyboard shortcuts (YouTube-style).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = v();
      if (!el) return;
      let handled = true;
      switch (e.key) {
        case " ":
        case "k":
          togglePlay();
          break;
        case "j":
          seekBy(-10);
          flash("−10s");
          break;
        case "l":
          seekBy(10);
          flash("+10s");
          break;
        case "ArrowLeft":
          if (!e.shiftKey) {
            handled = false;
            break;
          }
          seekBy(-5);
          break;
        case "ArrowRight":
          if (!e.shiftKey) {
            handled = false;
            break;
          }
          seekBy(5);
          break;
        case "ArrowUp":
          setVol(el.volume + 0.1);
          flash(`Volume ${Math.round(Math.min(1, el.volume + 0.1) * 100)}%`);
          break;
        case "ArrowDown":
          setVol(el.volume - 0.1);
          flash(`Volume ${Math.round(Math.max(0, el.volume - 0.1) * 100)}%`);
          break;
        case "m":
          el.muted = !el.muted;
          flash(el.muted ? "Muted" : "Sound on");
          break;
        case "f":
          toggleFullscreen();
          break;
        case "p":
          if (document.pictureInPictureEnabled) {
            (document.pictureInPictureElement ? document.exitPictureInPicture() : el.requestPictureInPicture()).catch(() => {});
          }
          break;
        case ",":
          el.pause();
          el.currentTime = Math.max(0, el.currentTime - 1 / 30);
          break;
        case ".":
          el.pause();
          el.currentTime = Math.min(el.duration, el.currentTime + 1 / 30);
          break;
        case "<":
        case ">": {
          const idx = SPEEDS.indexOf(el.playbackRate);
          const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (idx < 0 ? 3 : idx) + (e.key === ">" ? 1 : -1)))];
          el.playbackRate = next;
          flash(`${next}×`);
          break;
        }
        case "r":
          setLoop((l) => {
            flash(l ? "Loop off" : "Loop on");
            return !l;
          });
          break;
        default:
          if (/^[0-9]$/.test(e.key)) el.currentTime = (Number(e.key) / 10) * (el.duration || 0);
          else handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        poke();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, togglePlay, seekBy, setVol, toggleFullscreen, poke, flash]);

  useEffect(() => {
    if (!active) v()?.pause();
  }, [active]);

  // ─── Scrub bar ───
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return { x: f * r.width, t: f * (duration || 0) };
  };
  const onBarDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    const { t } = timeAt(e.clientX);
    if (v()) v()!.currentTime = t;
  };
  const onBarMove = (e: React.PointerEvent) => {
    const h = timeAt(e.clientX);
    setHover(h);
    if (scrubbing && v()) v()!.currentTime = h.t;
  };

  const sb = item.storyboard;
  const tile = hover && sb ? Math.min(sb.count - 1, Math.floor(hover.t / sb.interval)) : 0;

  // Touch: tap shows chrome, double-tap left/right thirds seeks.
  const lastTap = useRef(0);
  const onSurfaceClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const now = Date.now();
    const r = e.currentTarget.getBoundingClientRect();
    const third = (e.clientX - r.left) / r.width;
    if (now - lastTap.current < 280) {
      if (third < 0.33) {
        seekBy(-10);
        setRipple({ side: "l", key: now });
      } else if (third > 0.67) {
        seekBy(10);
        setRipple({ side: "r", key: now });
      } else toggleFullscreen();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    const pointerFine = window.matchMedia("(pointer: fine)").matches;
    setTimeout(() => {
      if (lastTap.current === now) {
        if (pointerFine) togglePlay();
        else if (chrome && playing) setChrome(false);
        else poke();
      }
    }, 285);
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const processing = item.status === "processing";
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  if (processing && !item.has.playback) {
    return (
      <div className="relative flex size-full items-center justify-center">
        {item.has.poster && <img src={mediaUrl(item, "poster")} alt="" className="absolute inset-0 m-auto max-h-full max-w-full object-contain opacity-40 blur-sm" />}
        <div className="glass relative flex flex-col items-center gap-3 rounded-3xl px-8 py-6 text-center">
          <ProgressRing value={item.progress} size={56} />
          <div>
            <p className="font-medium">{item.has.original ? "Optimizing for playback" : "Encrypting"}</p>
            <p className="mt-1 text-sm text-ink-400">
              {item.progress != null ? `${Math.round(item.progress * 100)}%` : "Starting…"}
              {item.has.original ? " · converting to a format every browser can play" : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className={cx("group/player relative flex size-full items-center justify-center bg-black/0 select-none", !chrome && playing && "cursor-none")}
      onPointerMove={poke}
      onMouseLeave={() => playing && setChrome(false)}
    >
      <video
        ref={video}
        key={item.id}
        src={mediaUrl(item, "stream")}
        poster={item.has.poster ? mediaUrl(item, "poster") : undefined}
        autoPlay={autoPlay}
        loop={loop}
        playsInline
        preload="metadata"
        controlsList="nodownload noremoteplayback"
        disableRemotePlayback
        className="size-full object-contain"
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* gesture surface */}
      <div className="absolute inset-0" onClick={onSurfaceClick} />

      <AnimatePresence>
        {ripple && (
          <motion.div
            key={ripple.key}
            initial={{ opacity: 0.6, scale: 0.6 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.55 }}
            onAnimationComplete={() => setRipple(null)}
            className={cx(
              "pointer-events-none absolute top-1/2 flex size-28 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-sm font-medium",
              ripple.side === "l" ? "left-[12%]" : "right-[12%]",
            )}
          >
            {ripple.side === "l" ? "−10s" : "+10s"}
          </motion.div>
        )}
      </AnimatePresence>

      {(waiting || error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {error ? (
            <div className="glass pointer-events-auto rounded-2xl px-5 py-4 text-center text-sm">
              <p>{error}</p>
              <a className="mt-2 inline-flex items-center gap-1.5 text-accent-400 hover:underline" href={mediaUrl(item, "original", true)}>
                <Download className="size-4" /> Download original
              </a>
            </div>
          ) : (
            <Spinner className="size-10 text-white/80" />
          )}
        </div>
      )}

      {!playing && !waiting && !error && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute top-1/2 left-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition hover:scale-105 hover:bg-white/25"
        >
          <Play className="ml-1 size-9 fill-white text-white" />
        </button>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3.5 py-1.5 text-sm backdrop-blur-md"
          >
            {toast}
          </motion.div>
        )}
        {resumedAt != null && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-24 left-4 flex items-center gap-3 rounded-full bg-black/70 py-1.5 pr-1.5 pl-4 text-sm backdrop-blur-md"
          >
            Resumed at {formatDuration(resumedAt)}
            <button
              className="rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25"
              onClick={() => {
                if (v()) v()!.currentTime = 0;
                setResumedAt(null);
              }}
            >
              Start over
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <div
        className={cx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-16 pb-2 transition-opacity duration-300 sm:px-5 sm:pb-4",
          chrome || !playing || scrubbing ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div
          ref={bar}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatDuration(time)}
          tabIndex={0}
          className="group/bar relative flex h-5 cursor-pointer touch-none items-center"
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={() => setScrubbing(false)}
          onPointerLeave={() => !scrubbing && setHover(null)}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/bar:h-1.5">
            {buffered.map(([s, e], i) => (
              <div key={i} className="absolute inset-y-0 bg-white/25" style={{ left: `${(s / (duration || 1)) * 100}%`, width: `${((e - s) / (duration || 1)) * 100}%` }} />
            ))}
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-500 to-cyan-400" style={{ width: `${pct}%` }} />
          </div>
          <div
            className="absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgb(139_92_246/0.35)] transition-transform group-hover/bar:scale-110"
            style={{ left: `${pct}%` }}
          />
          {hover && (
            <div className="pointer-events-none absolute bottom-6 -translate-x-1/2" style={{ left: Math.max(sb ? 84 : 24, Math.min(hover.x, (bar.current?.clientWidth ?? 0) - (sb ? 84 : 24))) }}>
              {sb && (
                <div
                  className="mb-1.5 overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl"
                  style={{
                    width: sb.tileW,
                    height: sb.tileH,
                    backgroundImage: `url(${mediaUrl(item, "storyboard")})`,
                    backgroundPosition: `-${(tile % sb.cols) * sb.tileW}px -${Math.floor(tile / sb.cols) * sb.tileH}px`,
                    backgroundSize: `${sb.cols * sb.tileW}px auto`,
                  }}
                />
              )}
              <div className="mx-auto w-fit rounded-md bg-black/80 px-2 py-0.5 font-mono text-xs">{formatDuration(hover.t)}</div>
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center gap-0.5 sm:gap-1">
          <CtlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={togglePlay}>
            {playing ? <Pause className="size-5 fill-white" /> : <Play className="size-5 fill-white" />}
          </CtlButton>
          <CtlButton label="Back 10s (j)" onClick={() => seekBy(-10)}>
            <RotateCcw className="size-[18px]" />
          </CtlButton>
          <CtlButton label="Forward 10s (l)" onClick={() => seekBy(10)}>
            <RotateCw className="size-[18px]" />
          </CtlButton>
          <div className="group/vol flex items-center">
            <CtlButton label="Mute (m)" onClick={() => v() && (v()!.muted = !v()!.muted)}>
              <VolIcon className="size-5" />
            </CtlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              aria-label="Volume"
              className="slider w-0 opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 max-sm:hidden"
              style={{ ["--fill" as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>
          <span className="ml-2 font-mono text-xs text-white/80 tabular-nums">
            {formatDuration(time)} <span className="text-white/40">/ {formatDuration(duration)}</span>
          </span>
          <div className="flex-1" />
          <CtlButton
            label="Speed (< >)"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSpeedMenu(speedMenu ? null : { x: r.left - 60, y: r.top - 340 });
            }}
          >
            <span className="flex items-center gap-1 text-xs font-semibold">
              <Gauge className="size-[18px]" />
              {speed !== 1 && `${speed}×`}
            </span>
          </CtlButton>
          <CtlButton label="Loop (r)" onClick={() => setLoop((l) => !l)} active={loop}>
            <Repeat className="size-[18px]" />
          </CtlButton>
          {typeof document !== "undefined" && document.pictureInPictureEnabled && (
            <CtlButton label="Picture in picture (p)" onClick={() => v()?.requestPictureInPicture().catch(() => {})}>
              <PictureInPicture2 className="size-[18px]" />
            </CtlButton>
          )}
          <CtlButton label="Fullscreen (f)" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
          </CtlButton>
        </div>
      </div>
      <FloatingMenu
        at={speedMenu}
        onClose={() => setSpeedMenu(null)}
        items={SPEEDS.map((s) => ({ label: s === 1 ? "Normal" : `${s}×`, checked: s === speed, onSelect: () => v() && (v()!.playbackRate = s) }))}
      />
    </div>
  );
}

function CtlButton({ label, onClick, children, active }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx("flex h-9 min-w-9 items-center justify-center rounded-lg px-1.5 transition hover:bg-white/15", active ? "text-cyan-300" : "text-white")}
    >
      {children}
    </button>
  );
}
