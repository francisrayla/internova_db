"use client";

import { Pill } from "@/components/dean/ui";

// One place for the intern status groups, attendance calendar and projected finish used by every Dean screen.

export const GROUPS = {
  at_risk: { label: "At risk", tone: "red", help: "Behind schedule or not showing up" },
  needs_attention: { label: "Needs attention", tone: "amber", help: "One thing to look at" },
  on_track: { label: "On track", tone: "green", help: "No problems found" },
  completed: { label: "Completed", tone: "blue", help: "Finished or hours met" },
};

export const GROUP_ORDER = ["at_risk", "needs_attention", "on_track", "completed"];

export function GroupPill({ group, label }) {
  const g = GROUPS[group];
  return <Pill tone={g?.tone ?? "slate"}>{g?.label ?? label ?? "Not active"}</Pill>;
}

const TEXT = { green: "text-emerald-700", red: "text-red-600", amber: "text-amber-700", blue: "text-blue-700", slate: "text-slate-500" };

/** "On pace to finish Nov 20" plus "2 weeks after the end date" (red when it is later than the end date). */
export function Projection({ projection, className = "", compact = false }) {
  if (!projection) return null;
  const tone = TEXT[projection.tone] ?? TEXT.slate;
  return (
    <span className={`block min-w-0 ${className}`}>
      <span className={`block text-sm font-semibold ${tone}`}>{projection.label}</span>
      {projection.note && <span className={`block text-xs ${projection.late ? "font-semibold text-red-600" : "text-slate-500"} ${compact ? "" : "mt-0.5"}`}>{projection.note}</span>}
    </span>
  );
}

const WORD = { P: "Present", M: "Waiting for approval", X: "Rejected", A: "Absent", O: "No work day", F: "Not yet" };
const CELL = {
  P: "bg-emerald-500 text-white",
  A: "bg-red-500 text-white",
  M: "bg-amber-400 text-amber-950",
  X: "bg-amber-400 text-amber-950",
  O: "bg-slate-100 text-slate-400",
  F: "border border-dashed border-slate-300 text-slate-400",
};
const DOT = {
  P: "bg-emerald-500",
  A: "bg-red-500",
  M: "bg-amber-400",
  X: "bg-amber-400",
  O: "bg-slate-200",
  F: "border border-dashed border-slate-300",
};

/** 28 days from the API's compact calendar ({ start, codes, hours }). */
export function calendarDays(cal) {
  if (!cal?.codes) return [];
  const [y, m, d] = cal.start.split("-").map(Number);
  return [...cal.codes].map((code, i) => {
    const date = new Date(y, m - 1, d + i);
    const hours = cal.hours?.[i];
    const dateText = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return { date, code, hours, label: `${dateText}: ${WORD[code]}${hours != null ? `, ${hours} h` : ""}` };
  });
}

const count = (days, ...codes) => days.filter((x) => codes.includes(x.code)).length;

/** Last 2 weeks as small dots for cards. */
export function CalendarDots({ calendar }) {
  const days = calendarDays(calendar).slice(14);
  if (days.length === 0) return null;
  const summary = `Last 2 weeks: ${count(days, "P")} present, ${count(days, "A")} absent${count(days, "M", "X") ? `, ${count(days, "M", "X")} waiting or rejected` : ""}`;
  return (
    <span role="img" aria-label={summary} className="inline-flex shrink-0 gap-0.5">
      {days.map((x, i) => (
        <span key={i} title={x.label} className={`h-2.5 w-2.5 rounded-full ${DOT[x.code]}`} />
      ))}
    </span>
  );
}

export function CalendarLegend() {
  const items = [["P", "Present"], ["A", "Absent"], ["M", "Waiting or rejected"], ["O", "Weekend or outside the deployment"], ["F", "Not yet"]];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map(([code, text]) => (
        <li key={code} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${DOT[code]}`} aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}

/** Full 4-week grid, Monday to Sunday columns. */
export function AttendanceCalendar({ calendar }) {
  const days = calendarDays(calendar);
  if (days.length === 0) return null;
  const heads = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="space-y-3">
      <div role="group" aria-label={`Attendance for the last 4 weeks: ${count(days, "P")} days present, ${count(days, "A")} absent`} className="max-w-lg">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500">
          {heads.map((h) => <span key={h}>{h}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((x, i) => (
            <div key={i} role="img" aria-label={x.label} title={x.label} className={`flex h-9 min-w-0 items-center justify-center rounded-lg text-xs font-semibold ${CELL[x.code]}`}>
              {x.date.getDate()}
            </div>
          ))}
        </div>
      </div>
      <CalendarLegend />
      <p className="text-xs text-slate-400">Holidays are not excluded, so a holiday on a weekday shows as absent.</p>
    </div>
  );
}
