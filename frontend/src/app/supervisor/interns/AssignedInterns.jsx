"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSupervisorData } from "@/lib/supervisorApi";

import { inputProps } from "@/lib/inputRules";
import NavIcon from "@/components/NavIcon";
import { EmptyState, ErrorNote, Pill, ProgressBar, SkeletonList } from "@/components/ui";
import { FilterBar, Page, PageHeader, SearchField, Section } from "@/components/dash/page";

const STATUS_TONES = {
  active: "green",
  pending: "amber",
  completed: "blue",
  invitation_pending: "amber",
  inactive: "slate",
  terminated: "red",
};

// "completed" = finished their required hours (or marked completed), the same as the coordinator and the Dean.
const STATUS_LABELS = { invitation_pending: "Pending account", completed: "Completed" };

function StatusPill({ intern: i }) {
  const key = i.display_status ?? i.status;
  return (
    <Pill tone={STATUS_TONES[key] ?? "slate"} className="capitalize">
      {STATUS_LABELS[key] ?? key}
    </Pill>
  );
}

function Meter({ left, right, pct, label }) {
  return (
    <div className="w-36 max-w-full max-sm:w-44">
      <div className="mb-1 flex justify-between gap-2 text-xs text-slate-500">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <ProgressBar pct={pct} label={label} />
    </div>
  );
}

export default function AssignedInterns() {
  const [interns, setInterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchSupervisorData("interns")
      .then((r) => setInterns(r.interns ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = interns.filter((i) => !query || i.intern_name?.toLowerCase().includes(query.toLowerCase()));

  return (
    <Page>
      <PageHeader title="Interns" sentence="Every intern at your company (shared with your fellow supervisor): hours, tasks, and evaluation progress." />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search interns by name"
        />
      </FilterBar>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : filtered.length === 0 && error ? null : filtered.length === 0 ? (
          <div className="k-pad">
            <EmptyState
              icon="users"
              title={interns.length === 0 ? "No interns yet" : "No matches"}
              text={interns.length === 0 ? "No interns are deployed at your company yet." : "No interns match this search."}
            />
          </div>
        ) : (
          <div className="k-tablewrap">
            <table className="k-table is-stack is-hover min-w-[760px] max-sm:min-w-0">
              <thead>
                <tr>
                  <th>Intern</th>
                  <th>Company</th>
                  <th>Hours</th>
                  <th>Tasks</th>
                  <th>Latest evaluation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.deployment_id} className="align-top">
                    <td className="is-title">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{i.intern_name}</p>
                          <p className="text-xs font-normal text-slate-500">{[i.student_number, i.course].filter(Boolean).join(" · ") || "—"}</p>
                        </div>
                        <span className="shrink-0 sm:hidden"><StatusPill intern={i} /></span>
                      </div>
                      {i.pending_attendance > 0 && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{i.pending_attendance} attendance record{i.pending_attendance === 1 ? "" : "s"} pending review</p>
                      )}
                      <Link href={`/supervisor/interns/${i.deployment_id}/portfolio`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline max-sm:min-h-[44px]">
                        View portfolio
                        <NavIcon name="arrow" size={13} />
                      </Link>
                    </td>
                    <td data-label="Company" className="text-slate-700">{i.company_name ?? "—"}</td>
                    <td data-label="Hours">
                      <Meter left={`${i.hours_completed}h`} right={`${i.required_hours}h`} pct={i.hours_progress_pct} label="Hours progress" />
                    </td>
                    <td data-label="Tasks">
                      <Meter left={`${i.tasks_completed}/${i.tasks_total}`} right={`${i.task_progress_pct}%`} pct={i.task_progress_pct} label="Task progress" />
                    </td>
                    <td data-label="Latest evaluation" className="text-slate-700">
                      {i.latest_evaluation_score != null ? `${Number(i.latest_evaluation_score)}%` : <span className="text-slate-500">No evaluations yet</span>}
                    </td>
                    <td className="max-sm:hidden">
                      <StatusPill intern={i} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Page>
  );
}
