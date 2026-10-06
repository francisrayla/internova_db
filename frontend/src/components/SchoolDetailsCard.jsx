"use client";

import { useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";

const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

/**
 * The school's basic details. `role` picks the API area ("dean" or
 * "coordinator"); only the Dean can edit, a coordinator passes readOnly.
 */
export default function SchoolDetailsCard({ role, readOnly = false }) {
  const [school, setSchool] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchApiData(role, "school-settings")
      .then((data) => {
        setSchool(data.school);
        setForm(data.school);
      })
      .catch(() => setSchool(null))
      .finally(() => setLoading(false));
  }, [role]);

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
      const res = await apiFetch(`/api/${role}/school-settings`, {
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

  if (loading) return <p className="mt-6 text-sm text-slate-400">Loading…</p>;
  if (!school) return <p className="mt-6 text-sm text-red-600">Could not load your school&apos;s settings.</p>;

  if (editing) {
    return (
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
    );
  }

  const rows = [
    ["School Name", school.school_name],
    ["Address", school.address || "—"],
    ["Contact Email", school.contact_email || "—"],
    ["Contact Number", school.contact_number || "—"],
  ];

  return (
    <div className="mt-6 max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-sm">
      {success && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{success}</p>}
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2.5">
          <span className="shrink-0 text-slate-500">{label}</span>
          <span className="min-w-0 break-words text-right font-semibold text-slate-900">{value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 py-2.5">
        <span className="shrink-0 text-slate-500">School Status</span>
        <span className="font-semibold capitalize text-slate-900">{school.status}</span>
      </div>

      {readOnly ? (
        <p className="mt-3 text-xs text-slate-400">Your school&apos;s Dean manages these details.</p>
      ) : (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={startEdit} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
