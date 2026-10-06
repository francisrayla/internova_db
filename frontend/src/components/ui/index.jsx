"use client";

import Link from "next/link";
import Icon from "@/components/Icon";

// Status chip colors shared by every Dean screen: green ok, amber needs attention, red overdue, blue info.
const TONES = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  slate: "bg-slate-100 text-slate-600",
};

export function Pill({ tone = "slate", size = "md", children, className = "" }) {
  const sizing = size === "sm" ? "px-2 py-0 text-[11px] leading-5" : "px-2.5 py-0.5 text-xs";
  return <span className={`inline-flex items-center rounded-full font-semibold ${sizing} ${TONES[tone] ?? TONES.slate} ${className}`}>{children}</span>;
}

export function ProgressBar({ pct = 0, tone, label }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-red-500" : value >= 100 ? "bg-emerald-500" : "bg-blue-600";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function Avatar({ name, url, size = 40 }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function SectionTitle({ title, help, action }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {help && <p className="text-sm text-slate-500">{help}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "check", title, text, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon name={icon} size={20} />
      </span>
      <p className="mt-3 font-semibold text-slate-800">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} />;
}

export function SkeletonList({ rows = 3, height = "h-20" }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1" role="tablist">
      <div className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => onChange(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              active === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${t.alert ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BackLink({ href, children }) {
  return (
    <Link href={href} className="text-sm font-semibold text-blue-600 hover:underline">
      {children}
    </Link>
  );
}

/** Short status message (success / error / info) shown above a list. */
export function Banner({ tone = "green", children, onDismiss }) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
  };
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm ${styles[tone] ?? styles.blue}`}>
      <span className="min-w-0">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="shrink-0 font-semibold underline">
          Dismiss
        </button>
      )}
    </div>
  );
}
