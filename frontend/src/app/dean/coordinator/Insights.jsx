"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import { ErrorNote, Pill, SectionTitle, Skeleton } from "@/components/dean/ui";

function Scorecard({ scorecard }) {
  return (
    <section>
      <SectionTitle title="Coordinator scorecard" help="How the coordinator is doing, in plain numbers." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {scorecard.metrics.map((m) => (
          <div key={m.key} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold text-slate-700">{m.title}</p>
              <Pill tone={m.verdict.tone}>{m.verdict.label}</Pill>
            </div>
            <p className={`mt-2 text-xl font-bold ${m.verdict.key === "none" ? "text-slate-400" : "text-slate-900"}`}>{m.display}</p>
            <p className="mt-1 text-xs text-slate-500">{m.detail}</p>
          </div>
        ))}
      </div>
      <details className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">How these are worked out</summary>
        <p className="mt-2">{scorecard.help.review_time}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {scorecard.help.thresholds.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Checklist({ checklist }) {
  return (
    <section>
      <SectionTitle
        title={`Setup checklist: ${checklist.done} of ${checklist.total}`}
        help="What a school needs in place for monitoring to work well."
      />
      <ul className="relative divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 px-4 py-3">
            <span
              aria-hidden
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
            >
              {item.ok ? "✓" : "!"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {item.label}
                <span className="sr-only">{item.ok ? " (done)" : " (not done yet)"}</span>
              </p>
              <p className="break-words text-sm text-slate-500">{item.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityChart({ chart }) {
  const diff = chart.this_week - chart.last_week;
  const trend = diff === 0 ? "the same as last week" : diff > 0 ? `${diff} more than last week` : `${-diff} fewer than last week`;
  return (
    <section>
      <SectionTitle title="Coordinator activity" help="Actions per day over the last 4 weeks. Lighter bars are weekends." />
      <div className="relative rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          <span className="font-bold text-slate-900">{chart.this_week}</span> {chart.this_week === 1 ? "action" : "actions"} this week, <span className="font-semibold">{trend}</span> ({chart.last_week}).
        </p>
        <p className="sr-only">{chart.summary}</p>
        <div className="mt-4 flex h-28 items-end gap-[2px] sm:gap-1" aria-hidden>
          {chart.days.map((d) => {
            const h = d.future ? 4 : Math.max(d.count ? 8 : 3, Math.round((d.count / chart.max) * 100));
            const color = d.future ? "bg-slate-100" : d.count === 0 ? "bg-slate-200" : d.weekend ? "bg-blue-300 dark:bg-blue-400/50" : "bg-blue-600";
            return (
              <div key={d.date} title={d.label} className="flex h-full min-w-0 flex-1 items-end">
                <div className={`w-full rounded-t-sm ${color}`} style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px] leading-tight text-slate-500 sm:text-xs" aria-hidden>
          {chart.weeks.map((w) => (
            <div key={w.label} className="min-w-0">
              <p className="truncate">{w.label}</p>
              <p className="font-semibold text-slate-700">{w.total}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Scorecard, setup checklist and activity chart — the Coordinator page's Summary tab. */
export default function Insights() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/insights").then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorNote onRetry={load}>We couldn&apos;t load the scorecard.</ErrorNote>;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Scorecard scorecard={data.scorecard} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ActivityChart chart={data.activity_chart} />
        <Checklist checklist={data.checklist} />
      </div>
    </div>
  );
}
