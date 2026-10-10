"use client";

import Link from "next/link";
import { Pill } from "@/components/ui";

const PRIORITY_TONES = { low: "slate", medium: "amber", high: "red" };

/**
 * Once a task is done it drops out of the active board/list entirely and
 * only lives here — a plain, non-interactive record of what got finished
 * and when.
 */
export default function TaskHistoryRow({ task, detailBasePath, subLabel }) {
  return (
    <Link href={`${detailBasePath}/${task.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 transition hover:bg-slate-50 sm:px-5 sm:py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill tone={PRIORITY_TONES[task.priority] ?? "slate"} size="sm" className="shrink-0 capitalize">{task.priority}</Pill>
          <p className="min-w-0 break-words font-medium text-slate-700 line-through decoration-slate-300">{task.title}</p>
        </div>
        {subLabel && <p className="mt-1.5 text-sm text-slate-500">{subLabel}</p>}
      </div>
      <Pill tone="green" className="shrink-0">
        Done{task.completed_at ? ` · ${task.completed_at}` : ""}
      </Pill>
    </Link>
  );
}
