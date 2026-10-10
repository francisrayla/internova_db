"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { ProgressBar } from "@/components/dean/ui";
import { CalendarDots, GroupPill, Projection } from "@/components/dean/monitoring";
import { timeAgo } from "@/lib/timeAgo";

// The keys are the `sort` values GET /api/dean/interns understands: the server orders the whole list (every page), not just this one.
export const SORT_DEFAULT_DIR = { name: "asc", group: "asc", company: "asc" }; // every other column starts high to low
const COLUMNS = [
  { key: "name", label: "Intern" },
  { key: "group", label: "Status" },
  { key: "company", label: "Company / supervisor" },
  { key: "hours", label: "Hours" },
  { key: "finish", label: "Projected finish" },
  { key: "clock", label: "Last clock-in" },
  { key: "journal", label: "Journal" },
  { key: "tasks", label: "Tasks done" },
  { key: "eval", label: "Evaluation" },
  { key: "narrative", label: "Narrative" },
];

function SortHeader({ col, sort, onSort }) {
  const active = sort.key === col.key;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className="whitespace-nowrap">
      <button type="button" onClick={() => onSort(col.key)} className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-blue-700" : ""}`}>
        {col.label}
        {active ? (sort.dir === "asc" ? <ArrowUp aria-hidden="true" size={12} strokeWidth={2} /> : <ArrowDown aria-hidden="true" size={12} strokeWidth={2} />) : <ArrowUpDown aria-hidden="true" size={12} strokeWidth={2} className="opacity-60" />}
      </button>
    </th>
  );
}

/**
 * Desktop table of interns with sortable headers; scrolls inside its own container if it is wider than the page.
 * `sort` ({ key, dir }) and `onSort(key)` belong to the parent, which asks the server for the order.
 */
export default function InternTable({ interns, sort, onSort }) {
  const rows = interns;

  return (
    <div className="dash-card is-flush relative w-full max-w-full">
      <div className="k-tablewrap">
      <table className="k-table is-hover min-w-[960px]">
        <caption className="sr-only">Interns with status, hours, projected finish, last clock-in, journal entries, tasks, evaluation and narrative progress. Use the column headers to sort.</caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />)}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.deployment_id} className="align-top">
              <td className="max-w-[180px]">
                <Link href={`/dean/interns/${i.deployment_id}`} className="block truncate font-semibold text-slate-900 hover:text-blue-700 hover:underline">{i.intern_name}</Link>
                <span className="mt-1 flex items-center gap-2 text-xs text-slate-500"><CalendarDots calendar={i.calendar} /></span>
              </td>
              <td className="whitespace-nowrap" title={i.flags.map((f) => f.label).join(" · ") || undefined}>
                <GroupPill group={i.status_group} />
                {i.flags.length > 0 && <p className="mt-1 text-xs text-slate-500">{i.flags.length} {i.flags.length === 1 ? "flag" : "flags"}</p>}
              </td>
              <td className="max-w-[200px]">
                <p className="truncate text-slate-800">{i.company_name ?? "No company"}</p>
                {i.moved_from && <p className="truncate text-xs text-slate-500">Moved from {i.moved_from}</p>}
                <p className="truncate text-xs text-slate-500">{i.supervisor_name ?? <span className="text-amber-700">No supervisor yet</span>}</p>
              </td>
              <td className="w-36">
                <p className="mb-1 whitespace-nowrap text-xs text-slate-500"><span className="font-semibold text-slate-800">{i.hours_completed}</span> / {i.required_hours}</p>
                <ProgressBar pct={i.hours_progress_pct} tone={i.flags.some((f) => f.key === "behind_hours") ? "amber" : undefined} label={`${i.intern_name} hours progress`} />
              </td>
              <td className="min-w-[150px]"><Projection projection={i.projection} compact /></td>
              <td className="whitespace-nowrap text-slate-700">{i.last_clock_in_at ? timeAgo(i.last_clock_in_at) : <span className="text-slate-400">Never</span>}</td>
              <td className="text-slate-700">{i.journal_entries}</td>
              <td className="whitespace-nowrap text-slate-700">{i.tasks_done} / {i.tasks_total}</td>
              <td className="whitespace-nowrap text-slate-700">{i.latest_evaluation_score !== null ? `${Number(i.latest_evaluation_score)}%` : <span className="text-slate-400">{i.has_evaluation ? "Done" : "None yet"}</span>}</td>
              <td className="whitespace-nowrap text-slate-700">{i.narrative_total ? `${i.narrative_done} / ${i.narrative_total}` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
