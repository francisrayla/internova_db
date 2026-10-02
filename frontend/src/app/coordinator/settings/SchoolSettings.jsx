"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";

import { clean, inputProps } from "@/lib/inputRules";
const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

export default function SchoolSettingsPage() {
  const { user } = useCurrentUser();
  const [school, setSchool] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function load() {
    fetchCoordinatorData("school-settings")
      .then((data) => {
        setSchool(data.school);
        setForm(data.school);
      })
      .catch(() => setSchool(null))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (!user) return null;

  if (!user.is_primary_coordinator) {
    return (
      <div className="sm:p-2 lg:p-6">
        <h1 className="text-2xl font-semibold">School Settings</h1>
        <p className="mt-2 text-slate-600">Only the school&apos;s primary coordinator can view or edit school settings.</p>
      </div>
    );
  }

  function startEdit() {
    setForm(school);
    setError("");
    setSuccess("");
    setEditing(true);
  }

  function cancelEdit() {
    setForm(school);
    setError("");
    setEditing(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.school_name.trim() || !form.address.trim() || !form.contact_email.trim() || !form.contact_number.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (form.contact_number.length !== 11) {
      setError("Contact number must be exactly 11 digits.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coordinator/school-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update school settings.");
      setSchool(data.school);
      setForm(data.school);
      setEditing(false);
      setSuccess("School settings updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sm:p-2 lg:p-6">
      <h1 className="text-2xl font-semibold">School Settings</h1>
      <p className="mt-2 text-slate-600">Basic information for your school account.</p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">Loading…</p>
      ) : !school ? (
        <p className="mt-6 text-sm text-red-600">Could not load your school&apos;s settings.</p>
      ) : editing ? (
        <form onSubmit={handleSubmit} className="mt-6 max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">School Name</span>
            <input {...inputProps("orgName")} value={form.school_name} onChange={(e) => setForm((f) => ({ ...f, school_name: e.target.value }))} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Address</span>
            <input {...inputProps("address")} value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Contact Email</span>
            <input {...inputProps("email")} type="email" value={form.contact_email ?? ""} onChange={(e) => setForm((f) => ({ ...f, contact_email: clean("email", e.target.value) }))} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Contact Number</span>
            <input {...inputProps("phone")}
              type="tel"
              inputMode="numeric"
              value={form.contact_number ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, contact_number: clean("phone", e.target.value) }))}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">11 digits, e.g. 09171234567.</span>
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={cancelEdit} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-6 max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          {success && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{success}</p>}
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">School Name</span>
            <span className="font-semibold text-slate-900">{school.school_name}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">Address</span>
            <span className="font-semibold text-slate-900">{school.address || "—"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">Contact Email</span>
            <span className="font-semibold text-slate-900">{school.contact_email || "—"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">Contact Number</span>
            <span className="font-semibold text-slate-900">{school.contact_number || "—"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">Primary Coordinator</span>
            <span className="font-semibold text-slate-900">{user.name}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-slate-500">School Status</span>
            <span className="font-semibold capitalize text-slate-900">{school.status}</span>
          </div>

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={startEdit} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
