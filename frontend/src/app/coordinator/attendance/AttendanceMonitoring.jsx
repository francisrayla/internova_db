"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

export default function AttendanceMonitoring() {
  const [records, setRecords] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : "";
    fetchCoordinatorData(`attendance${params}`)
      .then((r) => setRecords(r.records ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Attendance</h2>
        <p className="mt-1 text-sm text-slate-600">
          Read-only — attendance is logged and verified by each intern&apos;s supervisor, since they&apos;re the one who actually sees them show up.
        </p>
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
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading attendance…</p>
        ) : records.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No attendance records yet.</p>
        ) : (
          records.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div>
                <p className="font-medium text-slate-900">{r.intern_name}</p>
                <p className="text-xs text-slate-500">
                  {r.attendance_date} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
