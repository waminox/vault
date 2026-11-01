"use client";

import { Check, Eye, HardDrive, KeyRound, Laptop, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BASE, HttpError, api } from "@/lib/client/api";
import { describeAgent, formatBytes, formatDate, timeAgo } from "@/lib/client/format";
import { usePrefs } from "@/lib/client/prefs";
import type { Stats } from "@/lib/types";
import { Button, Dialog, Switch, cx, useAsk } from "./ui";

type Tab = "privacy" | "security" | "sessions" | "storage";

export function Settings({ open, onClose, stats }: { open: boolean; onClose: () => void; stats: Stats | null }) {
  const [tab, setTab] = useState<Tab>("privacy");
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "privacy", label: "Privacy", icon: <Eye className="size-4" /> },
    { id: "security", label: "Security", icon: <KeyRound className="size-4" /> },
    { id: "sessions", label: "Sessions", icon: <Laptop className="size-4" /> },
    { id: "storage", label: "Storage", icon: <HardDrive className="size-4" /> },
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Settings" wide>
      <div className="flex min-h-[460px] flex-col sm:flex-row">
        <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx("flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm whitespace-nowrap", tab === t.id ? "bg-white/[0.08] text-white" : "text-ink-300 hover:bg-white/[0.04]")}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-5">
          {tab === "privacy" && <PrivacyTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "storage" && <StorageTab stats={stats} />}
        </div>
      </div>
    </Dialog>
  );
}

function PrivacyTab() {
  const [p, set] = usePrefs();
  return (
    <div className="divide-y divide-white/[0.05]">
      <Switch label="Blur thumbnails on open" hint="Start every visit with the library blurred. Toggle with B." checked={p.blurOnLoad} onChange={(v) => set({ blurOnLoad: v })} />
      <Switch label="Peek on hover" hint="Hovering a blurred tile reveals just that one." checked={p.peekOnHover} onChange={(v) => set({ peekOnHover: v })} />
      <Switch label="Shield when the window loses focus" hint="Covers the screen on alt-tab, app switching and in task-switcher previews." checked={p.shieldOnBlur} onChange={(v) => set({ shieldOnBlur: v })} />
      <Switch label="Panic key" hint="Press Esc three times quickly to lock and leave the page instantly." checked={p.panicKey} onChange={(v) => set({ panicKey: v })} />
      <Switch label="Video previews on hover" hint="Play a muted snippet when hovering a video (only when not blurred)." checked={p.hoverPreview} onChange={(v) => set({ hoverPreview: v })} />
      <label className="flex items-center justify-between gap-4 py-3">
        <span>
          <span className="block text-sm">Auto-lock when idle</span>
          <span className="mt-0.5 block text-xs text-ink-400">Locks this device after no activity. The server also ends idle sessions.</span>
        </span>
        <select
          value={p.autoLockMinutes}
          onChange={(e) => set({ autoLockMinutes: Number(e.target.value) })}
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
        >
          {[1, 5, 15, 30, 60, 0].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} min` : "Never"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 py-3">
        <span className="text-sm">Slideshow speed</span>
        <select value={p.slideshowSeconds} onChange={(e) => set({ slideshowSeconds: Number(e.target.value) })} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none">
          {[2, 3, 4, 6, 8, 12].map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SecurityTab() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState<{ enabled: boolean; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState("");
  const ask = useAsk();

  const loadTotp = useCallback(() => {
    api<{ totp: boolean }>("/api/auth/status").then((s) => setTotp({ enabled: s.totp }));
  }, []);
  useEffect(loadTotp, [loadTotp]);

  async function changePass(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", json: { current: cur, next } });
      toast.success("Passphrase changed. Other devices were signed out.");
      setCur("");
      setNext("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none focus:border-accent-500/60";

  return (
    <div className="space-y-8">
      <form onSubmit={changePass} className="space-y-3">
        <h3 className="text-sm font-semibold">Change passphrase</h3>
        <p className="text-xs leading-relaxed text-ink-400">Your media isn&apos;t re-encrypted — only the master key&apos;s wrapping changes, so this is instant.</p>
        <input type="password" autoComplete="current-password" placeholder="Current passphrase" value={cur} onChange={(e) => setCur(e.target.value)} className={field} />
        <input type="password" autoComplete="new-password" placeholder="New passphrase (10+ characters)" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
        <Button type="submit" variant="primary" size="sm" disabled={busy || !cur || next.length < 10}>
          Update passphrase
        </Button>
      </form>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="size-4" /> Two-factor authentication
          {totp?.enabled && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">On</span>}
        </h3>
        <p className="text-xs leading-relaxed text-ink-400">Require a code from an authenticator app (1Password, Aegis, Google Authenticator…) in addition to your passphrase.</p>
        {totp && !totp.enabled && !totp.qr && (
          <Button size="sm" variant="subtle" onClick={async () => setTotp(await api("/api/auth/totp"))}>
            <ShieldCheck className="size-4" /> Set up 2FA
          </Button>
        )}
        {totp?.qr && !totp.enabled && (
          <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row">
            <img src={totp.qr} alt="QR code for your authenticator app" className="size-40 rounded-xl bg-white p-1.5" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-xs text-ink-300">Scan the code, or enter this key manually:</p>
              <code className="block rounded-lg bg-black/40 px-2 py-1.5 font-mono text-[11px] break-all text-ink-200">{totp.secret?.replace(/(.{4})/g, "$1 ")}</code>
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("/api/auth/totp", { method: "POST", json: { code } });
                    toast.success("Two-factor authentication is on");
                    setTotp({ enabled: true });
                    setCode("");
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={cx(field, "font-mono tracking-widest")} />
                <Button type="submit" variant="primary" size="sm" className="h-10">
                  Verify
                </Button>
              </form>
            </div>
          </div>
        )}
        {totp?.enabled && (
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              const pass = await ask({ title: "Turn off 2FA", body: "Confirm with your passphrase.", input: { placeholder: "Passphrase" }, confirm: "Continue" });
              if (!pass) return;
              const c = await ask({ title: "Turn off 2FA", body: "Enter a current code from your app.", input: { placeholder: "123456" }, confirm: "Turn off", danger: true });
              if (!c) return;
              try {
                await api("/api/auth/totp", { method: "DELETE", json: { passphrase: pass, code: c } });
                toast.success("Two-factor authentication turned off");
                setTotp({ enabled: false });
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            Turn off
          </Button>
        )}
      </div>
    </div>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
}
interface LoginEvent {
  id: number;
  at: number;
  ip: string;
  user_agent: string;
  success: number;
  reason: string | null;
}

function SessionsTab() {
  const [data, setData] = useState<{ sessions: SessionRow[]; events: LoginEvent[] } | null>(null);
  const load = useCallback(() => {
    api<{ sessions: SessionRow[]; events: LoginEvent[] }>("/api/auth/sessions").then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!data) return <p className="text-sm text-ink-400">Loading…</p>;
  const failures = data.events.filter((e) => !e.success && Date.now() - e.at < 7 * 86400_000).length;
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Signed-in devices</h3>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", json: { everywhere: true } });
              window.location.replace(`${BASE}/login`);
            }}
          >
            <LogOut className="size-3.5" /> Lock everywhere
          </Button>
        </div>
        {data.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
            <Laptop className="size-4 text-ink-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {describeAgent(s.userAgent)} {s.current && <span className="ml-1 rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] text-accent-300">This device</span>}
              </p>
              <p className="text-xs text-ink-500">
                {s.ip} · active {timeAgo(s.lastSeenAt)} · since {formatDate(s.createdAt, true)}
              </p>
            </div>
            {!s.current && (
              <Button
                size="sm"
                onClick={async () => {
                  await api(`/api/auth/sessions?id=${s.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Recent sign-in attempts</h3>
        {failures > 0 && (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
            {failures} failed attempt{failures > 1 ? "s" : ""} in the last 7 days.
          </p>
        )}
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-white/[0.05]">
          {data.events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-b border-white/[0.04] px-3.5 py-2 text-xs last:border-0">
              <span className={cx("flex size-5 items-center justify-center rounded-full", e.success ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300")}>
                {e.success ? <Check className="size-3" /> : "×"}
              </span>
              <span className="flex-1 truncate text-ink-300">
                {describeAgent(e.user_agent)} · {e.ip}
                {!e.success && e.reason && <span className="text-ink-500"> · {e.reason.replace(/-/g, " ")}</span>}
              </span>
              <span className="text-ink-500">{timeAgo(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StorageTab({ stats }: { stats: Stats | null }) {
  const [server, setServer] = useState<{ ffmpeg: boolean; maxUploadBytes: number; trashDays: number } | null>(null);
  const ask = useAsk();
  useEffect(() => {
    api<{ server: typeof server }>("/api/stats").then((r) => setServer(r.server));
  }, []);
  if (!stats) return null;
  const cards: [string, string][] = [
    ["Photos", stats.photos.toLocaleString()],
    ["Videos", stats.videos.toLocaleString()],
    ["Originals", formatBytes(stats.bytes)],
    ["On disk (encrypted)", formatBytes(stats.storedBytes)],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
            <p className="text-xs text-ink-400">{k}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {server && (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-400">Video conversion (ffmpeg)</dt>
            <dd className={server.ffmpeg ? "text-emerald-300" : "text-amber-300"}>{server.ffmpeg ? "Available" : "Not installed"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-400">Max file size</dt>
            <dd>{formatBytes(server.maxUploadBytes)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-400">Trash is emptied after</dt>
            <dd>{server.trashDays} days</dd>
          </div>
        </dl>
      )}
      {stats.trash > 0 && (
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            const ok = await ask({ title: "Empty trash?", body: `${stats.trash} items will be shredded permanently.`, confirm: "Empty trash", danger: true });
            if (!ok) return;
            try {
              const r = await api<{ purged: number }>("/api/trash", { method: "DELETE" });
              toast.success(`Shredded ${r.purged} items`);
            } catch (err) {
              toast.error(err instanceof HttpError ? err.message : "Failed");
            }
          }}
        >
          Empty trash ({stats.trash})
        </Button>
      )}
    </div>
  );
}
