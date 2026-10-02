"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import AddInternModal from "@/components/AddInternModal";
import { clampOnBlur } from "@/lib/clampNumber";

import { clean, inputProps, cleanNumber } from "@/lib/inputRules";
const STATUS_STYLES = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  terminated: "bg-red-100 text-red-700",
};

function ProgressBar({ pct }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function EditCompanyModal({ company, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    company_name: company.company_name ?? "",
    address: company.address ?? "",
    contact_email: company.contact_email ?? "",
    contact_number: company.contact_number ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(extra = {}) {
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update company.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${company.company_name}? This can't be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/companies/${company.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete company.");
      onDeleted();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Edit company</h3>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Company name</span>
            <input {...inputProps("orgName")} value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Address</span>
            <input {...inputProps("address")} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact email</span>
              <input {...inputProps("email")} type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: clean("email", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact number</span>
              <input {...inputProps("phone")} type="tel" value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: clean("phone", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-2">
            <button type="button" onClick={handleDelete} disabled={saving} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => save({ status: company.status === "active" ? "inactive" : "active" })}
                disabled={saving}
                className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {company.status === "active" ? "Mark inactive" : "Mark active"}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSupervisorModal({ companyId, companyName, onClose, onSaved }) {
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
        <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900">Supervisor account created</h3>
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
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Add a supervisor</h3>
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

function EditSupervisorModal({ supervisor, onClose, onSaved }) {
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
    if (!window.confirm(`Delete ${supervisor.name}? This can't be undone.`)) return;
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
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Edit supervisor</h3>
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
            <button type="button" onClick={handleDelete} disabled={saving} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
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

/**
 * Two separate actions, deliberately kept apart:
 * - Updating hours/start date edits the current deployment in place — safe,
 *   since neither field affects history already logged against it.
 * - Reassigning to a different company never edits in place. It closes out
 *   the current deployment as "completed" and opens a brand new one, so any
 *   attendance/tasks already logged stay honestly attributed to where they
 *   actually happened instead of silently appearing to move companies too.
 */
function ManageDeploymentModal({ intern, currentCompanyId, onClose, onSaved }) {
  const [hoursForm, setHoursForm] = useState({ required_hours: intern.required_hours, start_date: intern.start_date_raw ?? "", supervisor_id: intern.supervisor_id ?? "" });
  const [currentCompanySupervisors, setCurrentCompanySupervisors] = useState([]);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursError, setHoursError] = useState("");

  const [companies, setCompanies] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [reassignForm, setReassignForm] = useState({ company_id: "", supervisor_id: "", start_date: "", required_hours: intern.required_hours });
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState("");

  useEffect(() => {
    fetchCoordinatorData("companies").then((r) => setCompanies(r.companies ?? [])).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    fetchCoordinatorData(`supervisors?company_id=${currentCompanyId}`)
      .then((r) => setCurrentCompanySupervisors(r.supervisors ?? []))
      .catch(() => setCurrentCompanySupervisors([]));
  }, [currentCompanyId]);

  useEffect(() => {
    if (!reassignForm.company_id) {
      setSupervisors([]);
      return;
    }
    fetchCoordinatorData(`supervisors?company_id=${reassignForm.company_id}`)
      .then((r) => setSupervisors(r.supervisors ?? []))
      .catch(() => setSupervisors([]));
  }, [reassignForm.company_id]);

  const otherActiveCompanies = companies.filter((c) => c.status === "active" && String(c.id) !== String(currentCompanyId));

  async function handleUpdateHours(e) {
    e.preventDefault();
    setSavingHours(true);
    setHoursError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hoursForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update deployment.");
      onSaved();
    } catch (err) {
      setHoursError(err.message);
    } finally {
      setSavingHours(false);
    }
  }

  async function handleReassign(e) {
    e.preventDefault();
    if (!reassignForm.company_id || !reassignForm.start_date || !reassignForm.required_hours) {
      setReassignError("Select a company, start date, and required hours.");
      return;
    }
    if (!window.confirm(`Move ${intern.intern_name} to a new company? This ends their current deployment here and starts a new one.`)) return;

    setReassigning(true);
    setReassignError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reassignForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not reassign intern.");
      onSaved();
    } catch (err) {
      setReassignError(err.message);
    } finally {
      setReassigning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Manage deployment</h3>
        <p className="mt-1 text-sm text-slate-500">{intern.intern_name} — currently at {intern.company_name}</p>

        <form onSubmit={handleUpdateHours} className="mt-5 space-y-3 rounded-2xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Update deployment details</p>
            <p className="text-xs text-slate-500">Assign or change their supervisor at {intern.company_name}, or adjust hours/start date.</p>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Supervisor</span>
            <select value={hoursForm.supervisor_id} onChange={(e) => setHoursForm((f) => ({ ...f, supervisor_id: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              <option value="">No supervisor assigned</option>
              {currentCompanySupervisors.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Required hours</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={hoursForm.required_hours}
                onChange={(e) => setHoursForm((f) => ({ ...f, required_hours: cleanNumber(e.target.value, { max: 2000 }) }))}
                onBlur={(e) => setHoursForm((f) => ({ ...f, required_hours: clampOnBlur(e.target.value, 1, 2000) }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Start date</span>
              <input type="date" value={hoursForm.start_date} onChange={(e) => setHoursForm((f) => ({ ...f, start_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {hoursError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{hoursError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={savingHours} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{savingHours ? "Saving…" : "Save"}</button>
          </div>
        </form>

        <form onSubmit={handleReassign} className="mt-4 space-y-3 rounded-2xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Reassign to a different company</p>
            <p className="text-xs text-slate-500">Ends the deployment here and starts a fresh one at the new company. Their hours/tasks/evaluations here stay on record.</p>
          </div>
          {otherActiveCompanies.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">No other active partner companies yet.</p>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">New company</span>
                <select value={reassignForm.company_id} onChange={(e) => setReassignForm((f) => ({ ...f, company_id: e.target.value, supervisor_id: "" }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  <option value="">Select a company…</option>
                  {otherActiveCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Supervisor</span>
                <select value={reassignForm.supervisor_id} onChange={(e) => setReassignForm((f) => ({ ...f, supervisor_id: e.target.value }))} disabled={!reassignForm.company_id} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
                  <option value="">No supervisor assigned yet</option>
                  {supervisors.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">New start date</span>
                  <input type="date" value={reassignForm.start_date} onChange={(e) => setReassignForm((f) => ({ ...f, start_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Required hours</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={reassignForm.required_hours}
                    onChange={(e) => setReassignForm((f) => ({ ...f, required_hours: cleanNumber(e.target.value, { max: 2000 }) }))}
                    onBlur={(e) => setReassignForm((f) => ({ ...f, required_hours: clampOnBlur(e.target.value, 1, 2000) }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                </label>
              </div>
            </>
          )}
          {reassignError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{reassignError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={reassigning || otherActiveCompanies.length === 0} className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
              {reassigning ? "Reassigning…" : "Reassign"}
            </button>
          </div>
        </form>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [supervisorQuery, setSupervisorQuery] = useState("");
  const [internQuery, setInternQuery] = useState("");
  const [internStatusFilter, setInternStatusFilter] = useState("All");

  const [editingCompany, setEditingCompany] = useState(false);
  const [showAddSupervisor, setShowAddSupervisor] = useState(false);
  const [editingSupervisor, setEditingSupervisor] = useState(null);
  const [showAddIntern, setShowAddIntern] = useState(false);
  const [deletingInternId, setDeletingInternId] = useState(null);
  const [managingIntern, setManagingIntern] = useState(null);
  const [resendingUserId, setResendingUserId] = useState(null);
  const [resentUserId, setResentUserId] = useState(null);

  function load() {
    setLoading(true);
    fetchCoordinatorData(`companies/${id}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function handleResendInvite(userId) {
    setResendingUserId(userId);
    setResentUserId(null);
    try {
      const res = await apiFetch(`/api/coordinator/users/${userId}/resend-invitation`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok || !resData.success) throw new Error(resData.message || "Could not resend the invitation.");
      setResentUserId(userId);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setResendingUserId(null);
    }
  }

  async function handleDeleteIntern(intern) {
    if (!window.confirm(`Delete ${intern.intern_name}? This can't be undone.`)) return;
    setDeletingInternId(intern.deployment_id);
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" });
      const resData = await res.json();
      if (!res.ok || !resData.success) throw new Error(resData.message || "Could not delete intern.");
      load();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setDeletingInternId(null);
    }
  }

  if (loading) {
    return <p className="px-2 py-10 text-center text-sm text-slate-500">Loading company…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/coordinator/companies" className="text-sm font-medium text-blue-600 hover:underline">&larr; Back to Companies</Link>
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Company not found."}</p>
      </div>
    );
  }

  const { company } = data;
  const internStatuses = ["All", ...new Set(data.interns.map((i) => i.status))];
  const filteredSupervisors = data.supervisors.filter(
    (s) => !supervisorQuery || s.name?.toLowerCase().includes(supervisorQuery.toLowerCase())
  );
  const filteredInterns = data.interns.filter((i) => {
    const matchesStatus = internStatusFilter === "All" || i.status === internStatusFilter;
    const matchesQuery = !internQuery || i.intern_name?.toLowerCase().includes(internQuery.toLowerCase());
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-6">
      <Link href="/coordinator/companies" className="text-sm font-medium text-blue-600 hover:underline">&larr; Back to Companies</Link>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{company.company_name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${company.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{company.status}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{company.company_code}{company.address ? ` · ${company.address}` : ""}</p>
            <p className="text-sm text-slate-400">{company.contact_email ?? "—"}{company.contact_number ? ` · ${company.contact_number}` : ""}</p>
          </div>
          <button onClick={() => setEditingCompany(true)} className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Supervisors ({data.supervisors.length})</h3>
          <button
            onClick={() => setShowAddSupervisor(true)}
            disabled={data.supervisors.length >= 2}
            title={data.supervisors.length >= 2 ? "This company already has the maximum of 2 supervisors." : undefined}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add supervisor
          </button>
        </div>
        {data.supervisors.length >= 2 && (
          <p className="mt-1.5 text-xs text-slate-400">Maximum of 2 supervisors reached for this company.</p>
        )}

        {data.supervisors.length > 0 && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <input {...inputProps("search")}
              value={supervisorQuery}
              onChange={(e) => setSupervisorQuery(e.target.value)}
              placeholder="Search supervisors by name…"
              className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {data.supervisors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No supervisors on file yet.</p>
          ) : filteredSupervisors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No supervisors match this search.</p>
          ) : (
            filteredSupervisors.map((s) => (
              <div key={s.user_id} className="flex items-center justify-between border-b border-slate-100 px-6 py-4 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.position ?? "Supervisor"} · {s.email}</p>
                  {s.account_status === "pending_activation" && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5">Invite pending</span>
                      {resentUserId === s.user_id ? (
                        <span className="text-emerald-600">Sent!</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleResendInvite(s.user_id)}
                          disabled={resendingUserId === s.user_id}
                          className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
                        >
                          {resendingUserId === s.user_id ? "Resending…" : "Resend invite"}
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <button onClick={() => setEditingSupervisor(s)} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Interns deployed here ({data.interns.length})</h3>
          {company.status === "active" && (
            <button onClick={() => setShowAddIntern(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add intern</button>
          )}
        </div>

        {data.interns.length > 0 && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <input {...inputProps("search")}
                value={internQuery}
                onChange={(e) => setInternQuery(e.target.value)}
                placeholder="Search interns by name…"
                className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
              />
              <select
                value={internStatusFilter}
                onChange={(e) => setInternStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-blue-500"
              >
                {internStatuses.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {data.interns.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No interns deployed to this company yet.</p>
          ) : filteredInterns.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No interns match this filter.</p>
          ) : (
            filteredInterns.map((i) => (
              <div key={i.deployment_id} className="border-b border-slate-100 px-6 py-4 last:border-b-0">
                {/* Stacked on mobile — name/course on top, status+actions
                    below, full width each — instead of squeezing both into
                    one row, which left almost no room for the name and
                    wrapped "Supervisor: ..." across several lines. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{i.intern_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {i.course ?? "—"}
                      {i.supervisor_name ? ` · Supervisor: ${i.supervisor_name}` : ""}
                    </p>
                    {!i.supervisor_name && i.status === "active" && (
                      <p className="mt-0.5 text-xs font-medium text-amber-600">No supervisor assigned — they won&apos;t be able to log attendance yet.</p>
                    )}
                    {i.account_status === "pending_activation" && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5">Invite pending</span>
                        {resentUserId === i.intern_id ? (
                          <span className="text-emerald-600">Sent!</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleResendInvite(i.intern_id)}
                            disabled={resendingUserId === i.intern_id}
                            className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
                          >
                            {resendingUserId === i.intern_id ? "Resending…" : "Resend invite"}
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[i.status] ?? "bg-slate-100 text-slate-700"}`}>{i.status}</span>
                    {i.status === "active" && (
                      <button
                        onClick={() => setManagingIntern(i)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Manage
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteIntern(i)}
                      disabled={deletingInternId === i.deployment_id}
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingInternId === i.deployment_id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="max-w-xs flex-1"><ProgressBar pct={i.hours_progress_pct} /></div>
                  <span className="shrink-0 text-xs text-slate-500">{i.hours_completed}/{i.required_hours}h</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {editingCompany && (
        <EditCompanyModal
          company={company}
          onClose={() => setEditingCompany(false)}
          onSaved={() => { setEditingCompany(false); load(); }}
          onDeleted={() => router.push("/coordinator/companies")}
        />
      )}
      {showAddSupervisor && (
        <AddSupervisorModal
          companyId={id}
          companyName={company.company_name}
          onClose={() => setShowAddSupervisor(false)}
          onSaved={() => { setShowAddSupervisor(false); load(); }}
        />
      )}
      {editingSupervisor && (
        <EditSupervisorModal
          supervisor={editingSupervisor}
          onClose={() => setEditingSupervisor(null)}
          onSaved={() => { setEditingSupervisor(null); load(); }}
        />
      )}
      {showAddIntern && (
        <AddInternModal
          lockedCompanyId={id}
          lockedCompanyName={company.company_name}
          onClose={() => setShowAddIntern(false)}
          onSaved={() => { setShowAddIntern(false); load(); }}
        />
      )}
      {managingIntern && (
        <ManageDeploymentModal
          intern={managingIntern}
          currentCompanyId={id}
          onClose={() => setManagingIntern(null)}
          onSaved={() => { setManagingIntern(null); load(); }}
        />
      )}
    </div>
  );
}
