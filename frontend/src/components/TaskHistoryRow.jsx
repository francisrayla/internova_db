"use client";

import Link from "next/link";

const PRIORITY_STYLES = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

/**
 * Once a task is done it drops out of the active board/list entirely and
 * only lives here — a plain, non-interactive record of what got finished
 * and when.
 */
export default function TaskHistoryRow({ task, detailBasePath, subLabel }) {
  return (
    <Link href={`${detailBasePath}/${task.id}`} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 opacity-80 transition hover:bg-slate-50 hover:opacity-100">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
          <p className="truncate font-medium text-slate-700 line-through decoration-slate-300">{task.title}</p>
        </div>
        {subLabel && <p className="mt-1.5 text-xs text-slate-400">{subLabel}</p>}
      </div>
      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        Done{task.completed_at ? ` · ${task.completed_at}` : ""}
      </span>
    </Link>
  );
}
