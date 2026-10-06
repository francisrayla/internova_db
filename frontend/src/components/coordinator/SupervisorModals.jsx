"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export function AddSupervisorModal({ companyId, companyName, onClose, onSaved }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", position: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Enter the supervisor's full name.");
    if (!/\S+@\S+\.\S+/.test(form.email)) return setError("Enter a valid email address.");

    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/supervisors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, company_id: companyId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not add supervisor.");
      setCreated({ email: data.email, password: data.temporary_password });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    const text = `Email: ${created.email}\nPassword: ${created.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
        <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
          <h3 className="text-base font-semibold text-slate-900">Supervisor account created</h3>
          <p className="mt-1 text-sm text-slate-600">
            The account is active right away. Share these sign-in details with the supervisor yourself — this password is shown only once and can&apos;t be viewed again after you close this window.
          </p>
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Email</span>
              <span className="font-medium text-slate-900">{created.email}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Temporary password</span>
              <span className="font-mono font-semibold text-slate-900">{created.password}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={copyCredentials} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {copied ? "Copied!" : "Copy details"}
            </button>
            <button type="button" onClick={onSaved} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Add a supervisor</h3>
        <p className="mt-1 text-sm text-slate-500">At {companyName}</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">First name</span>
              <input {...inputProps("personName")} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Last name</span>
              <input {...inputProps("personName")} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
            <input {...inputProps("email")} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: clean("email", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="supervisor@example.com" />
            <span className="mt-1 block text-xs text-slate-400">Used as their sign-in email. The account is created active with a password you&apos;ll hand them yourself.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Position</span>
            <select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              <option value="">Select position…</option>
              <option value="Staff">Staff</option>
              <option value="Supervisor">Supervisor</option>
            </select>
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Creating…" : "Create account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditSupervisorModal({ supervisor, onClose, onSaved }) {
  const [nameParts] = useState(() => {
    const parts = (supervisor.name ?? "").trim().split(" ");
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
  });
  const [form, setForm] = useState({
    first_name: nameParts.first,
    last_name: nameParts.last,
    email: supervisor.email ?? "",
    position: supervisor.position ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Enter the supervisor's full name.");
    if (!/\S+@\S+\.\S+/.test(form.email)) return setError("Enter a valid email address.");

    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/supervisors/${supervisor.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update supervisor.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/supervisors/${supervisor.user_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete supervisor.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Edit supervisor</h3>
        <ConfirmDialog open={confirmDelete} title={`Delete ${supervisor.name}?`} confirmLabel="Delete supervisor" busy={saving} error={error} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)}>
          <p>This removes their account for good and can&apos;t be undone. A supervisor who still has interns assigned can&apos;t be deleted.</p>
        </ConfirmDialog>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">First name</span>
              <input {...inputProps("personName")} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Last name</span>
              <input {...inputProps("personName")} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
            <input {...inputProps("email")} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: clean("email", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Position</span>
            <select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              <option value="">Select position…</option>
              <option value="Staff">Staff</option>
              <option value="Supervisor">Supervisor</option>
            </select>
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-2">
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export const MAX_SUPERVISORS = 2;

/**
 * Step one of "Add supervisor" from the all-supervisors page: which company?
 * Companies that already have the maximum are listed but can't be picked, with a plain explanation.
 */
export function ChooseCompanyDialog({ companies, onClose, onChoose }) {
  const [companyId, setCompanyId] = useState("");
  const available = companies.filter((c) => (c.supervisors_count ?? 0) < MAX_SUPERVISORS);
  const full = companies.filter((c) => (c.supervisors_count ?? 0) >= MAX_SUPERVISORS);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="Choose a company" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Which company is this supervisor for?</h3>
        <p className="mt-1 text-sm text-slate-500">Each company can have up to {MAX_SUPERVISORS} supervisors.</p>

        {companies.length === 0 ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">Add a partner company first, then you can add its supervisors.</p>
        ) : (
          <>
            {available.length === 0 ? (
              <p className="mt-4 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700">
                Every company already has its {MAX_SUPERVISORS} supervisors. To bring in someone new, open the company and edit one of its supervisors to replace them.
              </p>
            ) : (
              <label className="mt-4 block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Company</span>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  <option value="">Select a company…</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name} ({c.supervisors_count ?? 0} of {MAX_SUPERVISORS})</option>
                  ))}
                </select>
              </label>
            )}
            {full.length > 0 && available.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Not listed because they already have {MAX_SUPERVISORS} supervisors: {full.map((c) => c.company_name).join(", ")}. Edit one of their supervisors to replace them.
              </p>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            disabled={!companyId}
            onClick={() => onChoose(companies.find((c) => String(c.id) === companyId))}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
