"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const LIVE_TYPES = ["activity_reviewed"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DailyActivities() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ activity_date: todayISO(), title: "", description: "", hours_rendered: "" });
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetchInternData("activities")
      .then((data) => setActivities(data.activities ?? []))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(LIVE_TYPES, load);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Give this entry a short title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("activity_date", form.activity_date);
      formData.append("title", form.title.trim());
      if (form.description.trim()) formData.append("description", form.description.trim());
      formData.append("hours_rendered", form.hours_rendered === "" ? "0" : String(Number(form.hours_rendered)));
      if (photo) formData.append("photo", photo);

      const res = await apiFetch("/api/intern/activities", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this entry.");
      setForm({ activity_date: todayISO(), title: "", description: "", hours_rendered: "" });
      setPhoto(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Narrative Report</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Daily Activities</h1>
          <p className="mt-1 text-sm text-slate-600">Log what you accomplished today — your supervisor reviews these.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ Log an entry"}
        </button>
      </section>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Date</span>
              <input
                type="date"
                value={form.activity_date}
                max={todayISO()}
                onChange={(e) => setForm((f) => ({ ...f, activity_date: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Hours rendered</span>
              <input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={form.hours_rendered}
                onChange={(e) => setForm((f) => ({ ...f, hours_rendered: e.target.value }))}
                placeholder="e.g. 8"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Title</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Built the login page UI"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Narrative / reflection (optional)</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={4}
              placeholder="Describe what you did, what you learned, or any challenges you ran into…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Photo of today&apos;s work (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700"
            />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save entry"}
            </button>
          </div>
        </form>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Your entries</h2>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No entries yet — log your first one above.</p>
        ) : (
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="flex gap-3 rounded-2xl border border-slate-100 p-4">
                {a.photo_url && (
                  <a href={a.photo_url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={a.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                      <p className="text-xs text-slate-500">
                        {a.activity_date}
                        {a.hours_rendered > 0 ? ` · ${a.hours_rendered}h` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {a.status}
                    </span>
                  </div>
                  {a.description && <p className="mt-2 text-sm text-slate-600">{a.description}</p>}
                  {a.review_remarks && (
                    <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-semibold">Supervisor remarks:</span> {a.review_remarks}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
