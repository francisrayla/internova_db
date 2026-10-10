"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import { ChevronDown } from "lucide-react";
import NavIcon from "@/components/NavIcon";
import { ErrorNote, Pill, Skeleton } from "@/components/dean/ui";
import { Cols } from "@/components/dash";
import { DataList, DataRow, Section } from "@/components/dash/page";

function Scorecard({ scorecard }) {
  return (
    <Section title="Coordinator scorecard" help="How the coordinator is doing, in plain numbers." flush>
      <DataList>
        {scorecard.metrics.map((m) => (
          <DataRow
            key={m.key}
            wrap
            title={m.title}
            sub={m.detail}
            side={
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                <span className={`text-lg font-semibold ${m.verdict.key === "none" ? "text-slate-500" : "text-slate-900"}`}>{m.display}</span>
                <Pill tone={m.verdict.tone}>{m.verdict.label}</Pill>
              </span>
            }
          />
        ))}
        <li className="k-item">
          <details className="group text-sm text-slate-600">
            <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-2 font-semibold text-slate-700 max-sm:min-h-[44px] [&::-webkit-details-marker]:hidden">
              How these are worked out
              <ChevronDown aria-hidden="true" size={16} className="shrink-0 text-slate-500 transition group-open:rotate-180" />
            </summary>
            <p className="mt-2">{scorecard.help.review_time}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {scorecard.help.thresholds.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </details>
        </li>
      </DataList>
    </Section>
  );
}

function Checklist({ checklist }) {
  return (
    <Section title={`Setup checklist: ${checklist.done} of ${checklist.total}`} help="What a school needs in place for monitoring to work well." flush>
      <DataList>
        {checklist.items.map((item) => (
          <DataRow
            key={item.key}
            wrap
            lead={
              <span aria-hidden className={`shrink-0 self-start pt-0.5 ${item.ok ? "text-emerald-700" : "text-amber-700"}`}>
                <NavIcon name={item.ok ? "check" : "alert"} size={18} />
              </span>
            }
            title={
              <>
                {item.label}
                <span className="sr-only">{item.ok ? " (done)" : " (not done yet)"}</span>
              </>
            }
            sub={<span className="break-words">{item.hint}</span>}
          />
        ))}
      </DataList>
    </Section>
  );
}

function ActivityChart({ chart }) {
  const diff = chart.this_week - chart.last_week;
  const trend = diff === 0 ? "the same as last week" : diff > 0 ? `${diff} more than last week` : `${-diff} fewer than last week`;
  return (
    <Section title="Coordinator activity" help="Actions per day over the last 4 weeks. Lighter bars are weekends.">
      <div className="relative">
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
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs leading-tight text-slate-600" aria-hidden>
          {chart.weeks.map((w) => (
            <div key={w.label} className="min-w-0">
              <p className="break-words">{w.label}</p>
              <p className="font-semibold text-slate-700">{w.total}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
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
      <div className="space-y-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Scorecard scorecard={data.scorecard} />
      <Cols>
        <ActivityChart chart={data.activity_chart} />
        <Checklist checklist={data.checklist} />
      </Cols>
    </div>
  );
}
