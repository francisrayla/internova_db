"use client";

import { useEffect, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";

const STATUS_STYLES = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  terminated: "bg-red-100 text-red-700",
};

function ProgressBar({ pct, tone = "blue" }) {
  const bar = { blue: "bg-blue-600", emerald: "bg-emerald-600" }[tone] ?? "bg-blue-600";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Assigned Interns</h2>
        <p className="mt-1 text-sm text-slate-600">Interns you supervise — hours, tasks, and evaluation progress.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
        />
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading interns…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {interns.length === 0 ? "No interns are assigned to you yet." : "No interns match this search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Intern</th>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Hours</th>
                  <th className="px-5 py-3">Tasks</th>
                  <th className="px-5 py-3">Latest evaluation</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((i) => (
                  <tr key={i.deployment_id} className="align-top">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{i.intern_name}</p>
                      <p className="text-xs text-slate-500">{i.student_number} · {i.course}</p>
                      {i.pending_attendance > 0 && (
                        <p className="mt-1 text-xs font-medium text-amber-600">{i.pending_attendance} attendance record{i.pending_attendance === 1 ? "" : "s"} pending review</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-700">{i.company_name ?? "—"}</td>
                    <td className="px-5 py-4">
                      <div className="w-32">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>{i.hours_completed}h</span>
                          <span>{i.required_hours}h</span>
                        </div>
                        <ProgressBar pct={i.hours_progress_pct} />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="w-32">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>{i.tasks_completed}/{i.tasks_total}</span>
                          <span>{i.task_progress_pct}%</span>
                        </div>
                        <ProgressBar pct={i.task_progress_pct} tone="emerald" />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-700">
                      {i.latest_evaluation_score != null ? `${i.latest_evaluation_score}%` : <span className="text-slate-400">No evaluations yet</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[i.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
