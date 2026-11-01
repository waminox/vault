"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function Button({
  variant = "ghost",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70 disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" &&
          "bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[0_8px_24px_-8px_rgb(124_58_237/0.8)] hover:brightness-110 active:scale-[0.98]",
        variant === "ghost" && "text-ink-200 hover:bg-white/[0.06] hover:text-white",
        variant === "subtle" && "bg-white/[0.06] text-ink-100 hover:bg-white/[0.1] border border-white/[0.06]",
        variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/20",
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70 disabled:opacity-40",
        active ? "bg-accent-500/20 text-accent-400" : "text-ink-300 hover:bg-white/[0.07] hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] text-ink-300">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressRing({ value, size = 40, className }: { value: number | null; size?: number; className?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className={cx("-rotate-90", value == null && "animate-spin", className)}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="white" strokeOpacity="0.15" strokeWidth="3" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="url(#ringGrad)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={value == null ? c * 0.75 : c * (1 - Math.max(0.02, value))}
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-accent-500" : "bg-white/15")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative rounded-[10px] px-2.5 py-1 text-[13px] transition-colors",
            value === o.value ? "text-white" : "text-ink-400 hover:text-ink-200",
          )}
        >
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-[10px] bg-white/[0.1]" />}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", damping: 30, stiffness: 380 }}
              className={cx(
                "glass relative max-h-[92dvh] w-full overflow-hidden rounded-t-3xl shadow-2xl sm:rounded-3xl",
                wide ? "sm:max-w-3xl" : "sm:max-w-md",
              )}
            >
              {title && (
                <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                  <h2 className="text-[15px] font-semibold">{title}</h2>
                  <IconButton label="Close" onClick={onClose} className="-mr-2">
                    <X className="size-4" />
                  </IconButton>
                </div>
              )}
              <div className="max-h-[calc(92dvh-60px)] overflow-y-auto">{children}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

// ─── Prompt / confirm (promise based) ───────────────────────────────────────

interface AskOptions {
  title: string;
  body?: ReactNode;
  input?: { label?: string; initial?: string; placeholder?: string };
  confirm?: string;
  danger?: boolean;
  choices?: { value: string; label: string; danger?: boolean }[];
}
type Ask = (o: AskOptions) => Promise<string | null>;
const AskCtx = createContext<Ask>(async () => null);
export const useAsk = () => useContext(AskCtx);

export function AskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(AskOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState("");
  const ask = useCallback<Ask>(
    (o) =>
      new Promise((resolve) => {
        setValue(o.input?.initial ?? "");
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <AskCtx.Provider value={ask}>
      {children}
      <Dialog open={!!state} onClose={() => close(null)} title={state?.title}>
        {state && (
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (state.input && !value.trim()) return;
              close(state.input ? value.trim() : "ok");
            }}
          >
            {state.body && <div className="text-sm leading-relaxed text-ink-300">{state.body}</div>}
            {state.input && (
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={state.input.placeholder}
                aria-label={state.input.label ?? state.title}
                className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 text-sm outline-none focus:border-accent-500/60 focus:ring-4 focus:ring-accent-500/15"
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button type="button" onClick={() => close(null)}>
                Cancel
              </Button>
              {state.choices ? (
                state.choices.map((c) => (
                  <Button key={c.value} type="button" variant={c.danger ? "danger" : "subtle"} onClick={() => close(c.value)}>
                    {c.label}
                  </Button>
                ))
              ) : (
                <Button type="submit" variant={state.danger ? "danger" : "primary"} autoFocus={!state.input}>
                  {state.confirm ?? "OK"}
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
    </AskCtx.Provider>
  );
}

// ─── Menus ───────────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="glass min-w-52 rounded-2xl p-1.5 shadow-2xl shadow-black/50" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-white/[0.06]" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setOpen(it.submenu ? i : null)}>
            <button
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                if (it.submenu) return setOpen(open === i ? null : i);
                it.onSelect?.();
                onClose();
              }}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-40",
                it.danger ? "text-red-300 hover:bg-red-500/15" : "text-ink-100 hover:bg-white/[0.07]",
              )}
            >
              <span className="flex size-4 items-center justify-center text-ink-300">{it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.checked && <span className="size-1.5 rounded-full bg-accent-400" />}
              {it.hint && <span className="text-[11px] text-ink-500">{it.hint}</span>}
              {it.submenu && <span className="text-ink-500">›</span>}
            </button>
            {it.submenu && open === i && (
              <div className="absolute top-0 left-full z-10 max-h-[60vh] overflow-y-auto pl-1 max-sm:static max-sm:pl-3">
                <MenuList items={it.submenu} onClose={onClose} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/** A menu anchored at a point (context menu) or below a trigger element. */
export function FloatingMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "pointerdown" && ref.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [at, onClose]);
  if (!at) return null;
  return (
    <Portal>
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12 }}
        className="fixed z-[90]"
        style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? "visible" : "hidden" }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <MenuList items={items} onClose={onClose} />
      </motion.div>
    </Portal>
  );
}

export function MenuButton({ items, children, label, className }: { items: MenuItem[] | (() => MenuItem[]); children: ReactNode; label: string; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        className={cx("inline-flex items-center", className)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.right - 208, y: r.bottom + 6 });
        }}
      >
        {children}
      </button>
      <FloatingMenu at={at} items={typeof items === "function" ? (at ? items() : []) : items} onClose={() => setAt(null)} />
    </>
  );
}
