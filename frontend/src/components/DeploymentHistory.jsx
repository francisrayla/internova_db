"use client";

import { Pill } from "@/components/ui";

/**
 * Where the intern has been, oldest first. `history` comes from the API
 * (DeploymentHistoryService::segments) and is empty when the intern was never
 * reassigned, in which case nothing is shown. compact = a smaller list for the
 * intern's own profile.
 */
export default function DeploymentHistory({ history, compact = false, printable = false, bare = false, title = "Deployment history", className = "" }) {
  if (!Array.isArray(history) || history.length < 2) return null;
  return (
    <section className={`${bare ? "" : "dash-card"} ${printable ? "" : "print:hidden"} ${className}`} aria-label={title}>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {!compact && <p className="mt-0.5 text-sm text-slate-500">One deployment, moved between companies. Hours and records carry over.</p>}
      <ol className="mt-3 space-y-0">
        {history.map((h, idx) => {
          const last = idx === history.length - 1;
          return (
            <li key={`${h.company_id}-${idx}`} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && <span className="absolute left-[5px] top-3 h-full w-px bg-slate-200" aria-hidden />}
              <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${h.is_current ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-900" title={h.company_name ?? ""}>{h.company_name ?? "Company removed"}</p>
                  <Pill tone={h.is_current ? "green" : "slate"} size="sm">{h.is_current ? (h.status === "active" ? "Current" : "Last placement") : "Moved"}</Pill>
                </div>
                <p className="truncate text-sm text-slate-500" title={h.supervisor_name ?? ""}>{h.supervisor_name ?? "No supervisor"}</p>
                <p className="text-sm text-slate-600">
                  {h.range}
                  <span className="mx-1 text-slate-300">·</span>
                  <span className="font-semibold text-slate-800">{h.hours} h</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
