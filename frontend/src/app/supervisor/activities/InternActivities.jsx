"use client";

import { useEffect, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

export default function InternActivities() {
  const [activities, setActivities] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  function load() {
    const params = statusFilter ? `?status=${statusFilter}` : "";
    fetchSupervisorData(`activities${params}`)
      .then((r) => setActivities(r.activities ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function review(id, status) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/supervisor/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Daily Activities</h2>
        <p className="mt-1 text-sm text-slate-600">Review the narrative reports logged by interns assigned to you.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading activities…</p>
        ) : activities.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No activity entries yet.</p>
        ) : (
          activities.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="flex min-w-0 flex-1 gap-3">
                {a.photo_url && (
                  <a href={a.photo_url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={a.photo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                  </a>
                )}
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{a.title}</p>
                  <p className="text-xs text-slate-500">
                    {a.intern_name} · {a.activity_date}{a.hours_rendered > 0 ? ` · ${a.hours_rendered}h` : ""}
                  </p>
                  {a.description && <p className="mt-1.5 text-sm text-slate-600">{a.description}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-700"}`}>{a.status}</span>
                {a.status === "pending" && (
                  <>
                    <button onClick={() => review(a.id, "approved")} disabled={busyId === a.id} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Approve</button>
                    <button onClick={() => review(a.id, "rejected")} disabled={busyId === a.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
