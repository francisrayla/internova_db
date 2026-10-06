"use client";

import Link from "next/link";
import { Pill, ProgressBar } from "@/components/dean/ui";
import { CalendarDots, GroupPill, Projection } from "@/components/dean/monitoring";
import { timeAgo } from "@/lib/timeAgo";

const STATUS = {
  active: { label: "Active", tone: "green" },
  completed: { label: "Completed", tone: "blue" },
  inactive: { label: "Archived", tone: "slate" },
};

/** One intern as a card (read-only); used by the Interns page and the coordinator's "Interns they handle" tab. */
export default function InternCard({ intern }) {
  const status = STATUS[intern.status] ?? { label: intern.status, tone: "slate" };
  const narrativePct = intern.narrative_total ? Math.round((intern.narrative_done / intern.narrative_total) * 100) : 0;
  const behind = intern.flags.some((f) => f.key === "behind_hours");

  return (
    <Link href={`/dean/interns/${intern.deployment_id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{intern.intern_name}</p>
          <p className="truncate text-sm text-slate-500">
            {intern.company_name ?? "No company"} · {intern.supervisor_name ?? <span className="text-amber-700">No supervisor yet</span>}
            {intern.moved_from && <span className="text-slate-400"> · Moved from {intern.moved_from}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {intern.account_status === "pending" && <Pill tone="amber">Invite not accepted</Pill>}
          {intern.status_group && intern.status_group !== "inactive" ? <GroupPill group={intern.status_group} /> : <Pill tone={status.tone}>{status.label}</Pill>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Hours</span>
            <span>
              <span className="font-semibold text-slate-800">{intern.hours_completed}</span> of {intern.required_hours}
            </span>
          </div>
          <ProgressBar pct={intern.hours_progress_pct} tone={behind ? "amber" : undefined} label="Hours progress" />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Narrative report</span>
            <span>
              <span className="font-semibold text-slate-800">{intern.narrative_done}</span> of {intern.narrative_total}
            </span>
          </div>
          <ProgressBar pct={narrativePct} label="Narrative report progress" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Projection projection={intern.projection} compact />
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span>Last 2 weeks</span>
          <CalendarDots calendar={intern.calendar} />
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{intern.last_clock_in_at ? `Last clock-in ${timeAgo(intern.last_clock_in_at)}` : "Has not clocked in yet"}</p>

      {intern.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {intern.flags.map((f) => (
            <Pill key={f.key} tone={f.level}>
              {f.label}
            </Pill>
          ))}
        </div>
      )}
    </Link>
  );
}
