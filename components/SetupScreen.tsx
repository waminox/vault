"use client";

import { useMemo, useState } from "react";
import { Check, Lock, TriangleAlert } from "lucide-react";
import { BASE, HttpError, api } from "@/lib/client/api";
import { VaultDial } from "./VaultDial";
import { cx } from "./ui";

/** Very rough entropy estimate: enough to nudge towards long passphrases. */
function strength(p: string): { score: number; label: string } {
  if (!p) return { score: 0, label: "" };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  const unique = new Set(p).size / p.length;
  const bits = p.length * Math.log2(Math.max(pool, 2)) * Math.min(1, 0.5 + unique);
  const score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: ["", "Weak", "Okay", "Strong", "Excellent"][score] };
}

export function SetupScreen({ token: initialToken }: { token: string }) {
  const [token, setToken] = useState(initialToken);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const [state, setState] = useState<"idle" | "checking" | "error" | "open">("idle");
  const [error, setError] = useState<string | null>(null);
  const s = useMemo(() => strength(pass), [pass]);
  const valid = pass.length >= 10 && pass === confirm && ack && token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setState("checking");
    setError(null);
    try {
      await api("/api/auth/setup", { method: "POST", json: { token, passphrase: pass } });
      setState("open");
      setTimeout(() => window.location.replace(`${BASE}/`), 1100);
    } catch (err) {
      setState("error");
      setError(err instanceof HttpError ? err.message : "Setup failed");
      setTimeout(() => setState("idle"), 600);
    }
  }

  const field =
    "h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[15px] outline-none transition placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-4 focus:ring-accent-500/15";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-md">
        <VaultDial state={state} />
        <div className="mt-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your vault</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
            Everything you store is encrypted with a key that only this passphrase can unlock.
          </p>
        </div>
        <div className="mt-8 space-y-3">
          {!initialToken && (
            <input className={field} placeholder="Setup token (printed in the server log)" value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label="Setup token" />
          )}
          <input className={field} type="password" autoFocus autoComplete="new-password" placeholder="Passphrase (10+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passphrase" />
          <div className="flex items-center gap-3 px-1">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cx(
                    "h-1 flex-1 rounded-full transition-colors",
                    s.score >= i ? (s.score <= 1 ? "bg-red-400" : s.score === 2 ? "bg-amber-400" : "bg-emerald-400") : "bg-white/10",
                  )}
                />
              ))}
            </div>
            <span className="w-16 text-right text-xs text-ink-400">{s.label}</span>
          </div>
          <input className={field} type="password" autoComplete="new-password" placeholder="Repeat passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Repeat passphrase" />
          {confirm && pass !== confirm && <p className="px-1 text-xs text-red-300">Passphrases don&apos;t match</p>}

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5 text-[13px] leading-relaxed text-amber-100/90">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="sr-only" />
            <span className={cx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", ack ? "border-amber-300 bg-amber-300 text-black" : "border-amber-300/50")}>
              {ack ? <Check className="size-3.5" /> : <TriangleAlert className="size-3 text-amber-300" />}
            </span>
            I understand there is no recovery: if I forget this passphrase, the contents are unrecoverable by design.
          </label>

          <button
            type="submit"
            disabled={!valid || state === "checking"}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-accent-600 via-accent-500 to-cyan-500 font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Lock className="size-4" /> {state === "checking" ? "Forging keys…" : "Create vault"}
          </button>
          {error && <p className="text-center text-sm text-red-300">{error}</p>}
        </div>
      </form>
    </main>
  );
}
