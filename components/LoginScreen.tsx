"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { BASE, HttpError, api } from "@/lib/client/api";
import { VaultDial } from "./VaultDial";
import { cx } from "./ui";

export function LoginScreen({ totp }: { totp: boolean }) {
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "checking" | "error" | "open">("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase || state === "checking" || cooldown > 0) return;
    if (totp && code.replace(/\D/g, "").length !== 6) {
      setError("Enter the 6-digit code from your authenticator");
      return;
    }
    setState("checking");
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { passphrase, code: totp ? code : undefined } });
      setState("open");
      setPassphrase("");
      setTimeout(() => window.location.replace(`${BASE}/`), 1100);
    } catch (err) {
      setState("error");
      if (err instanceof HttpError && err.status === 429) setCooldown(Number(err.data.retryAfter ?? 30));
      setError(err instanceof HttpError ? err.message : "Can't reach the vault");
      setCode("");
      setTimeout(() => {
        setState("idle");
        inputRef.current?.select();
      }, 600);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_50%_30%,rgb(139_92_246/0.15),transparent_70%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm">
        <VaultDial state={state} />
        <div className="mt-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{state === "open" ? "Unlocked" : "Vault"}</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {state === "open" ? "Decrypting your library…" : "Enter your passphrase to unseal."}
          </p>
        </div>

        <div className={cx("mt-8 space-y-3 transition-opacity", state === "open" && "pointer-events-none opacity-0")}>
          <div className="group relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-500 group-focus-within:text-accent-400" />
            <input
              ref={inputRef}
              autoFocus
              type={show ? "text" : "password"}
              autoComplete="current-password"
              aria-label="Passphrase"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] pr-11 pl-10 text-[15px] outline-none transition placeholder:text-ink-500 focus:border-accent-500/60 focus:bg-white/[0.06] focus:ring-4 focus:ring-accent-500/15"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-500 hover:text-ink-200"
              aria-label={show ? "Hide passphrase" : "Show passphrase"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {totp && (
            <div className="group relative">
              <ShieldCheck className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-500 group-focus-within:text-accent-400" />
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Authenticator code"
                placeholder="6-digit code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 font-mono text-[15px] tracking-[0.3em] outline-none transition placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-4 focus:ring-accent-500/15"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!passphrase || state === "checking" || cooldown > 0}
            className="relative h-12 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-accent-600 via-accent-500 to-cyan-500 text-[15px] font-medium text-white shadow-[0_12px_40px_-12px_rgb(124_58_237/0.9)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
          >
            {cooldown > 0 ? `Locked out · ${cooldown}s` : state === "checking" ? "Unsealing…" : "Unlock"}
          </button>

          <p className={cx("min-h-5 text-center text-sm text-red-300 transition-opacity", error ? "opacity-100" : "opacity-0")} role="alert">
            {error}
          </p>
        </div>
      </form>
    </main>
  );
}
