import type { ReactNode } from "react";

export function Card({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold tracking-wide text-mist-100">
          {title}
        </h2>
        {aside ? <div className="text-xs text-mist-400">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

const BADGE_STYLES = {
  verified: "border-ok-400/40 text-ok-400",
  estimate: "border-warn-400/40 text-warn-400",
  recommendation: "border-signal-400/40 text-signal-400",
  missing: "border-bad-400/40 text-bad-400",
  neutral: "border-ink-600 text-mist-300",
} as const;
export type BadgeKind = keyof typeof BADGE_STYLES;

/** Distinguishes verified facts, AI estimates, recommendations and missing information. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${BADGE_STYLES[kind]}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded border border-dashed border-ink-700 px-3 py-4 text-sm text-mist-400">{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-mist-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-xl text-mist-100 tabular-nums">{value}</dd>
      {hint ? <dd className="text-[11px] text-mist-400">{hint}</dd> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: ReactNode }) {
  const cls =
    tone === "bad"
      ? "border-bad-400/50 bg-bad-400/10"
      : tone === "warn"
        ? "border-warn-400/50 bg-warn-400/10"
        : "border-signal-500/40 bg-signal-500/10";
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function money(n: number) {
  return `$${n.toFixed(2)}`;
}
