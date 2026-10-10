"use client";

import Link from "next/link";
import ActionMenu from "@/components/ui/ActionMenu";
import { Avatar, Pill, ProgressBar } from "@/components/ui";

/** The one place that turns an intern row into a status pill. */
export function internStatus(i) {
  if (i.display_status === "invitation_pending") {
    return i.email_bounced ? { label: "Email bounced", tone: "red" } : { label: "Invitation pending", tone: "amber" };
  }
  const map = {
    active: { label: "Active", tone: "green" },
    completed: { label: "Completed", tone: "blue" },
    inactive: { label: "Inactive", tone: "slate" },
    pending: { label: "Not started", tone: "amber" },
    terminated: { label: "Ended early", tone: "red" },
  };
  return map[i.display_status ?? i.status] ?? { label: i.status ?? "—", tone: "slate" };
}

// Short chip text for the table, where long sentences would push the actions
// column out of view; the full sentence stays in the tooltip and on cards.
const SHORT_LABEL = {
  no_supervisor: () => "No supervisor",
  behind_hours: () => "Behind on hours",
  no_clock_in: (c) => {
    const days = /\((\d+) working day/.exec(c.label)?.[1] ?? /for (\d+) working day/.exec(c.label)?.[1];
    return days ? `No clock-in · ${days} days` : "No clock-in";
  },
};

/** "Moved from ABC Technologies" - shown on the intern's single current row after a reassignment. */
function MovedFrom({ intern, className = "" }) {
  if (!intern.moved_from) return null;
  return (
    <p className={`truncate text-xs text-slate-500 ${className}`} title={`Moved from ${intern.moved_from}`}>
      Moved from {intern.moved_from}
    </p>
  );
}

function AttentionChips({ intern, compact = false, className = "" }) {
  const chips = intern.attention ?? [];
  if (chips.length === 0 && !(intern.pending_attendance > 0)) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {chips.map((c) => (
        <Pill key={c.key} tone={c.key === "no_clock_in" ? "red" : "amber"} size="sm" className="max-w-full">
          <span className="truncate" title={c.detail ?? c.label}>{compact && SHORT_LABEL[c.key] ? SHORT_LABEL[c.key](c) : c.label}</span>
        </Pill>
      ))}
      {intern.pending_attendance > 0 && (
        <Pill tone="blue" size="sm">
          {intern.pending_attendance} to review
        </Pill>
      )}
    </div>
  );
}

function HoursBar({ intern }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between gap-2 text-xs text-slate-500">
        <span className="md:hidden">Hours</span>
        <span>
          <span className="font-semibold text-slate-800">{intern.hours_completed}</span> of {intern.required_hours}
        </span>
      </div>
      <ProgressBar pct={intern.hours_progress_pct} label="Hours progress" />
    </div>
  );
}

function TasksBar({ intern }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between gap-2 text-xs text-slate-500">
        <span className="md:hidden">Tasks</span>
        <span>
          <span className="font-semibold text-slate-800">{intern.tasks_completed}</span> of {intern.tasks_total}
        </span>
      </div>
      <ProgressBar pct={intern.task_progress_pct} tone={undefined} label="Task progress" />
    </div>
  );
}

function subline(i) {
  return [i.student_number, i.course].filter(Boolean).join(" · ") || "No student details yet";
}

/**
 * Interns as a table (desktop) or cards (phones). Shared by the Interns page and
 * the company's Interns tab, so both look and behave the same.
 * menuFor(intern) returns the ActionMenu items (see useInternActions).
 */
export default function InternRoster({ interns, menuFor, showCompany = true }) {
  return (
    <>
      <ul className="k-list md:hidden">
        {interns.map((i) => {
          const status = internStatus(i);
          const meta = [showCompany ? i.company_name ?? "No company" : null, i.supervisor_name ?? "no supervisor yet"].filter(Boolean).join(" · ");
          return (
            <li key={i.deployment_id} className="px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-2.5">
                <Avatar name={i.intern_name} size={36} />
                <div className="min-w-0 flex-1">
                  <Link href={`/coordinator/interns/${i.deployment_id}/report`} className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-600 hover:underline">
                    {i.intern_name}
                  </Link>
                  <p className="line-clamp-2 text-xs text-slate-500" title={meta}>{meta}</p>
                </div>
                <Pill tone={status.tone} size="sm" className="shrink-0">{status.label}</Pill>
                <ActionMenu label={`Actions for ${i.intern_name}`} items={menuFor(i)} />
              </div>
              <MovedFrom intern={i} className="mt-1 pl-[46px]" />
              <div className="mt-2 grid grid-cols-1 gap-2 pl-[46px] sm:grid-cols-2 sm:gap-3">
                <HoursBar intern={i} />
                <TasksBar intern={i} />
              </div>
              <AttentionChips intern={i} compact className="mt-2 pl-[46px]" />
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="k-table min-w-[720px] xl:min-w-[860px]">
          <thead>
            <tr>
              <th>Intern</th>
              <th>{showCompany ? "Company and supervisor" : "Supervisor"}</th>
              <th>Hours</th>
              <th>Tasks</th>
              <th className="hidden xl:table-cell">Evaluation</th>
              <th>Status</th>
              <th className="sticky right-0"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {interns.map((i) => {
              const status = internStatus(i);
              return (
                <tr key={i.deployment_id} className="align-middle">
                  <td>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={i.intern_name} size={36} />
                      <div className="min-w-0 max-w-[11rem] xl:max-w-[12rem]">
                        <Link href={`/coordinator/interns/${i.deployment_id}/report`} className="block truncate font-semibold text-slate-900 hover:text-blue-600 hover:underline" title={i.intern_name}>
                          {i.intern_name}
                        </Link>
                        <p className="truncate text-xs text-slate-500" title={subline(i)}>{subline(i)}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="max-w-[11rem] space-y-0.5 xl:max-w-[12rem]">
                      {showCompany && <p className="truncate text-slate-800" title={i.company_name ?? ""}>{i.company_name ?? "No company"}</p>}
                      <MovedFrom intern={i} />
                      <p className="truncate text-xs text-slate-500" title={i.supervisor_name ?? ""}>
                        {i.supervisor_name ?? <span className="text-amber-700">No supervisor yet</span>}
                      </p>
                    </div>
                  </td>
                  <td><div className="w-28 xl:w-32"><HoursBar intern={i} /></div></td>
                  <td><div className="w-24 xl:w-28"><TasksBar intern={i} /></div></td>
                  <td className="hidden text-slate-700 xl:table-cell">
                    {i.latest_evaluation_score != null ? `${Number(i.latest_evaluation_score)}%` : <span className="text-slate-400">None yet</span>}
                  </td>
                  <td>
                    <div className="flex max-w-[12rem] flex-col items-start gap-1.5">
                      <Pill tone={status.tone}>{status.label}</Pill>
                      <AttentionChips intern={i} compact />
                    </div>
                  </td>
                  <td className="sticky right-0 bg-white text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.25)]">
                    <ActionMenu label={`Actions for ${i.intern_name}`} items={menuFor(i)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
