"use client";

import { useEffect, useState } from "react";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { apiFetch } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS, hoursForCourse } from "@/lib/internOptions";

const EMPTY_ACCOUNT = { first_name: "", last_name: "", email: "", course: "", course_other: "", year_level: "4th Year" };

/**
 * Reused from two entry points — the Interns screen (coordinator picks the
 * company) and a company's own detail view (company already known, so it's
 * locked rather than re-picked) — one real flow behind both doors.
 */
export default function AddInternModal({ companies, lockedCompanyId, lockedCompanyName, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [deployment, setDeployment] = useState({ company_id: lockedCompanyId ?? "", start_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invited, setInvited] = useState(false);

  const activeCompanies = (companies ?? []).filter((c) => c.status === "active");

  function validateStep1() {
    if (!account.first_name.trim() || !account.last_name.trim()) return "Enter the intern's full name.";
    if (!/\S+@\S+\.\S+/.test(account.email)) return "Enter a valid email address.";
    return "";
  }

  function goToStep2() {
    const err = validateStep1();
    if (err) return setError(err);
    setError("");
    setStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!deployment.company_id || !deployment.start_date) {
      setError("Select a company and a start date.");
      return;
    }
    if (account.course === "Other" && !account.course_other.trim()) {
      setError("Enter the program name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { course_other, ...accountPayload } = account;
      const course = account.course === "Other" ? course_other.trim() : account.course;
      const res = await apiFetch("/api/coordinator/interns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...accountPayload, course, ...deployment }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not add intern.");
      setInvited(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (invited) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
        <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900">Invitation sent</h3>
          <p className="mt-1 text-sm text-slate-600">
            We emailed <span className="font-medium text-slate-900">{account.email}</span> a link to set their own password and activate their account.
          </p>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onSaved} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Add an intern</h3>
          <span className="text-xs font-medium text-slate-400">Step {step} of 2</span>
        </div>
        {lockedCompanyName && <p className="mt-1 text-sm text-slate-500">Deploying to {lockedCompanyName}</p>}

        {step === 1 ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">First name</span>
                <input {...inputProps("personName")} value={account.first_name} onChange={(e) => setAccount((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Last name</span>
                <input {...inputProps("personName")} value={account.last_name} onChange={(e) => setAccount((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
              <input {...inputProps("email")} type="email" value={account.email} onChange={(e) => setAccount((f) => ({ ...f, email: clean("email", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="intern@example.com" />
              <span className="mt-1 block text-xs text-slate-400">They&apos;ll get an email here to set their password and enter their own student number.</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Course</span>
                <select
                  value={account.course}
                  onChange={(e) => setAccount((f) => ({ ...f, course: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Select course…</option>
                  {COURSE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Year level</span>
                <select value={account.year_level} onChange={(e) => setAccount((f) => ({ ...f, year_level: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  {YEAR_LEVEL_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            {account.course === "Other" && (
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Program name</span>
                <input {...inputProps("shortText")} value={account.course_other} onChange={(e) => setAccount((f) => ({ ...f, course_other: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. BS Marine Transportation" />
              </label>
            )}

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={goToStep2} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Next: Deployment</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {!lockedCompanyId && activeCompanies.length === 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">You don&apos;t have any active partner companies yet. Add one from the Companies screen first.</p>
            ) : (
              <>
                {lockedCompanyId ? (
                  <div className="block text-sm">
                    <span className="mb-1.5 block font-semibold text-slate-700">Company</span>
                    <p className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">{lockedCompanyName}</p>
                  </div>
                ) : (
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-semibold text-slate-700">Company</span>
                    <select value={deployment.company_id} onChange={(e) => setDeployment((f) => ({ ...f, company_id: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                      <option value="">Select a company…</option>
                      {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </label>
                )}
                <CompanySupervisorsNote companyId={deployment.company_id} companyName={lockedCompanyName ?? activeCompanies.find((c) => String(c.id) === String(deployment.company_id))?.company_name} />
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Start date</span>
                  <input type="date" value={deployment.start_date} onChange={(e) => setDeployment((f) => ({ ...f, start_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                </label>
                <div className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Required hours</span>
                  <p className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
                    {hoursForCourse(account.course === "Other" ? undefined : account.course)} hours
                  </p>
                  <span className="mt-1 block text-xs text-slate-400">
                    Fixed by {account.course === "Other" ? (account.course_other.trim() || "the intern's program") : account.course || "the intern's course"} — set on the Course step, not editable here.
                  </span>
                </div>
              </>
            )}

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStep(1)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</button>
              <button type="submit" disabled={saving || (!lockedCompanyId && activeCompanies.length === 0)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Sending invite…" : "Deploy & send invite"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
