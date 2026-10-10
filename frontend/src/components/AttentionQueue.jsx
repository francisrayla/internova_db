"use client";

import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { SectionTitle, Skeleton } from "@/components/ui";
import "@/components/dash/dash.css";

/**
 * THE "needs attention" list for every role (Dean, coordinator, supervisor, intern, super admin). It lives in the
 * notification bell and on the notification history page, not on the dashboards. Items come from
 * GET /api/notifications/attention already counted and linked; this component only draws them, so the look of the
 * list is changed here and nowhere else. Icons are Lucide, mapped by name in components/NavIcon.jsx.
 *
 * items: [{ key, tone: "red" | "amber" | "blue" | "green", title, detail, href, count? }]
 * Items without an href are drawn as plain (non-clickable) cards.
 * compact: the small rows used inside the bell panel (no heading, tighter, always one column).
 */
const TONES = {
  red: { dot: "bg-red-100 text-red-700", icon: "alert" },
  amber: { dot: "bg-amber-100 text-amber-700", icon: "bell" },
  blue: { dot: "bg-blue-100 text-blue-700", icon: "info" },
  green: { dot: "bg-emerald-100 text-emerald-700", icon: "ok" },
};

function QueueCard({ item, compact, onNavigate }) {
  const tone = TONES[item.tone] ?? TONES.blue;
  const body = (
    <>
      <span className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full ${tone.dot} ${compact ? "h-7 w-7" : "h-8 w-8"}`}>
        <NavIcon name={tone.icon} size={compact ? 14 : 16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold text-slate-900 ${compact ? "text-[13px] leading-snug" : "text-sm"}`}>{item.title}</span>
        {item.detail && <span className={`block text-slate-600 ${compact ? "mt-0.5 text-xs leading-snug" : "text-sm"}`}>{item.detail}</span>}
      </span>
      {item.href && <span className="self-center text-slate-400"><NavIcon name="arrow" size={compact ? 14 : 16} /></span>}
    </>
  );
  const cls = `flex items-start gap-3 transition ${compact ? "rounded-xl px-2 py-2.5" : "px-4 py-3.5 sm:px-5"}`;
  return item.href ? (
    <Link href={item.href} onClick={onNavigate} data-count={item.count ?? undefined} className={`${cls} hover:bg-slate-100`}>{body}</Link>
  ) : (
    <div data-count={item.count ?? undefined} className={cls}>{body}</div>
  );
}

export default function AttentionQueue({
  title = "Needs your attention",
  subtitle,
  items,
  loading = false,
  compact = false,
  onNavigate,
  emptyTitle = "Nothing needs you right now",
  emptyText = "We'll show it here when something does.",
}) {
  const list = items ?? [];

  if (compact) {
    return (
      <section aria-label={title} className="border-b border-slate-100 bg-slate-50 px-3 py-3">
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        {loading ? (
          <Skeleton className="h-14" />
        ) : list.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><NavIcon name="ok" size={14} /></span>
            <p className="text-xs font-semibold text-slate-800">{emptyTitle}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {list.map((item) => <QueueCard key={item.key} item={item} compact onNavigate={onNavigate} />)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label={title}>
      <SectionTitle title={title} help={subtitle} />
      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><NavIcon name="ok" size={18} /></span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{emptyTitle}</p>
            <p className="text-sm text-slate-600">{emptyText}</p>
          </div>
        </div>
      ) : (
        <div className="dash-card is-flush divide-y divide-slate-100">
          {list.map((item) => <QueueCard key={item.key} item={item} onNavigate={onNavigate} />)}
        </div>
      )}
    </section>
  );
}
