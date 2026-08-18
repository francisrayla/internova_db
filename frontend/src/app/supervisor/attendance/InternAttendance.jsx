"use client";

import { useEffect, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

function mapsLink(loc) {
  return loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
}

function LogAttendanceModal({ interns, onClose, onSaved }) {
  const [form, setForm] = useState({ deployment_id: interns[0]?.deployment_id ?? "", attendance_date: "", clock_in: "", clock_out: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deployment_id || !form.attendance_date) {
      setError("Select an intern and a date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/supervisor/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not log attendance.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Log attendance</h3>
        <p className="mt-1 text-sm text-slate-500">Logged by you counts as verified — no separate approval needed.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Intern</span>
            <select
              value={form.deployment_id}
              onChange={(e) => setForm((f) => ({ ...f, deployment_id: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            >
              {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Date</span>
            <input type="date" value={form.attendance_date} onChange={(e) => setForm((f) => ({ ...f, attendance_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Clock in</span>
              <input type="time" value={form.clock_in} onChange={(e) => setForm((f) => ({ ...f, clock_in: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Clock out</span>
              <input type="time" value={form.clock_out} onChange={(e) => setForm((f) => ({ ...f, clock_out: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Log attendance"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InternAttendance() {
  const [records, setRecords] = useState([]);
  const [interns, setInterns] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    const params = statusFilter ? `?status=${statusFilter}` : "";
    fetchSupervisorData(`attendance${params}`)
      .then((r) => {
        setRecords(r.records ?? []);
        setInterns(r.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function review(id, status) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/supervisor/attendance/${id}`, {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Attendance</h2>
          <p className="mt-1 text-sm text-slate-600">Log and verify attendance for the interns assigned to you.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={interns.length === 0}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Log attendance
        </button>
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
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {r.clock_in_selfie_url && <img src={r.clock_in_selfie_url} alt="Clock in selfie" className="h-11 w-11 rounded-full border-2 border-white object-cover" />}
                  {r.clock_out_selfie_url && <img src={r.clock_out_selfie_url} alt="Clock out selfie" className="h-11 w-11 rounded-full border-2 border-white object-cover" />}
                </div>
                <div>
                  <p className="font-medium text-slate-900">{r.intern_name}</p>
                  <p className="text-xs text-slate-500">
                    {r.attendance_date} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                  </p>
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                    {r.clock_in_location && (
                      <a href={mapsLink(r.clock_in_location)} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                        In location ↗
                      </a>
                    )}
                    {r.clock_out_location && (
                      <a href={mapsLink(r.clock_out_location)} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                        Out location ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                {r.status === "pending" && (
                  <>
                    <button onClick={() => review(r.id, "approved")} disabled={busyId === r.id} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Approve</button>
                    <button onClick={() => review(r.id, "rejected")} disabled={busyId === r.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {showModal && (
        <LogAttendanceModal
          interns={interns}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}
