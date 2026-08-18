"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import AddInternModal from "@/components/AddInternModal";

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

export default function InternMonitoring() {
  const [interns, setInterns] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  async function handleDelete(intern) {
    if (!window.confirm(`Delete ${intern.intern_name}? This can't be undone.`)) return;
    setDeletingId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete intern.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function load() {
    setLoading(true);
    Promise.all([fetchCoordinatorData("interns"), fetchCoordinatorData("companies")])
      .then(([internsRes, companiesRes]) => {
        setInterns(internsRes.interns ?? []);
        setCompanies(companiesRes.companies ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const statuses = ["All", ...new Set(interns.map((i) => i.status))];
  const filtered = interns.filter((i) => {
    const matchesStatus = statusFilter === "All" || i.status === statusFilter;
    const matchesQuery =
      !query ||
      i.intern_name?.toLowerCase().includes(query.toLowerCase()) ||
      i.company_name?.toLowerCase().includes(query.toLowerCase());
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Interns</h2>
          <p className="mt-1 text-sm text-slate-600">Every intern deployed under your school — hours, tasks, and evaluation progress at a glance.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Add intern
        </button>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or company…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-blue-500"
          >
            {statuses.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading interns…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {interns.length === 0 ? "No interns have been deployed yet." : "No interns match this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Intern</th>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Hours</th>
                  <th className="px-5 py-3">Tasks</th>
                  <th className="px-5 py-3">Latest evaluation</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
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
                    <td className="px-5 py-4 text-slate-700">
                      {i.company_name ?? "—"}
                      {i.supervisor_name && <p className="text-xs text-slate-400">Supervisor: {i.supervisor_name}</p>}
                    </td>
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
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => handleDelete(i)}
                        disabled={deletingId === i.deployment_id}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingId === i.deployment_id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAdd && (
        <AddInternModal companies={companies} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}
