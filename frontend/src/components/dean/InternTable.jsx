"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProgressBar } from "@/components/dean/ui";
import { CalendarDots, GROUP_ORDER, GroupPill, Projection } from "@/components/dean/monitoring";
import { timeAgo } from "@/lib/timeAgo";

// Sort value per column; null always sorts last.
const COLUMNS = [
  { key: "name", label: "Intern", value: (i) => (i.intern_name ?? "").toLowerCase() },
  { key: "group", label: "Status", value: (i) => { const n = GROUP_ORDER.indexOf(i.status_group); return n === -1 ? 9 : n; } },
  { key: "company", label: "Company / supervisor", value: (i) => (i.company_name ?? "").toLowerCase() },
  { key: "hours", label: "Hours", value: (i) => i.hours_progress_pct },
  { key: "finish", label: "Projected finish", value: (i) => i.projection?.finish_date ?? null },
  { key: "clock", label: "Last clock-in", value: (i) => (i.last_clock_in_at ? new Date(i.last_clock_in_at).getTime() : null) },
  { key: "journal", label: "Journal", value: (i) => i.journal_entries },
  { key: "tasks", label: "Tasks done", value: (i) => i.tasks_done },
  { key: "eval", label: "Evaluation", value: (i) => i.latest_evaluation_score },
  { key: "narrative", label: "Narrative", value: (i) => (i.narrative_total ? i.narrative_done / i.narrative_total : -1) },
];

function SortHeader({ col, sort, onSort }) {
  const active = sort.key === col.key;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-slate-500">
      <button type="button" onClick={() => onSort(col.key)} className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-blue-700" : ""}`}>
        {col.label}
        <span aria-hidden className="text-[10px]">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

/** Desktop table of interns with sortable headers; scrolls inside its own container if it is wider than the page. */
export default function InternTable({ interns }) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return interns;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...interns].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [interns, sort]);

  function onSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "company" || key === "group" ? "asc" : "desc" }));
  }

  return (
    <div className="relative w-full max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <caption className="sr-only">Interns with status, hours, projected finish, last clock-in, journal entries, tasks, evaluation and narrative progress. Use the column headers to sort.</caption>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {COLUMNS.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((i) => (
            <tr key={i.deployment_id} className="align-top hover:bg-slate-50">
              <td className="max-w-[180px] px-3 py-3">
                <Link href={`/dean/interns/${i.deployment_id}`} className="block truncate font-semibold text-slate-900 hover:text-blue-700 hover:underline">{i.intern_name}</Link>
                <span className="mt-1 flex items-center gap-2 text-xs text-slate-500"><CalendarDots calendar={i.calendar} /></span>
              </td>
              <td className="whitespace-nowrap px-3 py-3" title={i.flags.map((f) => f.label).join(" · ") || undefined}>
                <GroupPill group={i.status_group} />
                {i.flags.length > 0 && <p className="mt-1 text-xs text-slate-500">{i.flags.length} {i.flags.length === 1 ? "flag" : "flags"}</p>}
              </td>
              <td className="max-w-[200px] px-3 py-3">
                <p className="truncate text-slate-800">{i.company_name ?? "No company"}</p>
                <p className="truncate text-xs text-slate-500">{i.supervisor_name ?? <span className="text-amber-700">No supervisor yet</span>}</p>
              </td>
              <td className="w-36 px-3 py-3">
                <p className="mb-1 whitespace-nowrap text-xs text-slate-500"><span className="font-semibold text-slate-800">{i.hours_completed}</span> / {i.required_hours}</p>
                <ProgressBar pct={i.hours_progress_pct} tone={i.flags.some((f) => f.key === "behind_hours") ? "amber" : undefined} label={`${i.intern_name} hours progress`} />
              </td>
              <td className="min-w-[150px] px-3 py-3"><Projection projection={i.projection} compact /></td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-700">{i.last_clock_in_at ? timeAgo(i.last_clock_in_at) : <span className="text-slate-400">Never</span>}</td>
              <td className="px-3 py-3 text-slate-700">{i.journal_entries}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-700">{i.tasks_done} / {i.tasks_total}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-700">{i.latest_evaluation_score !== null ? `${i.latest_evaluation_score}%` : <span className="text-slate-400">{i.has_evaluation ? "Done" : "None yet"}</span>}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-700">{i.narrative_total ? `${i.narrative_done} / ${i.narrative_total}` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
