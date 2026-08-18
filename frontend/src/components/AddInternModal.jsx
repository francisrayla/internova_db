"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";

// The programs this school actually offers — kept as a fixed list (with an
// "Other" escape hatch) instead of free text so course names stay consistent
// across every intern record instead of drifting into typos/variants.
const COURSE_OPTIONS = ["BSIT", "BSTM", "BSBA", "BSHM", "BSAIS", "BTELED", "BSCRIM"];

// OJT timing isn't standardized across schools/programs — some place interns
// in 3rd year, others only in 4th, and 5-year programs (e.g. some engineering
// tracks) exist too. Rather than assume this school's own pattern, the full
// range is offered and left for the coordinator to pick per intern.
const YEAR_LEVEL_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

// Required OJT hours by program — BSCRIM follows a shorter practicum, every
// other program (including "Other") runs the standard 500 hours for now.
const HOURS_BY_COURSE = { BSIT: 500, BSCRIM: 250 };
function defaultHoursForCourse(course) {
  return HOURS_BY_COURSE[course] ?? 500;
}

const EMPTY_ACCOUNT = { first_name: "", last_name: "", email: "", student_number: "", course: "", course_other: "", year_level: "" };

/**
 * Reused from two entry points — the Interns screen (coordinator picks the
 * company) and a company's own detail view (company already known, so it's
 * locked rather than re-picked) — one real flow behind both doors.
 */
export default function AddInternModal({ companies, lockedCompanyId, lockedCompanyName, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [deployment, setDeployment] = useState({ company_id: lockedCompanyId ?? "", supervisor_id: "", start_date: "", required_hours: "" });
  const [supervisors, setSupervisors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invited, setInvited] = useState(false);

  const activeCompanies = (companies ?? []).filter((c) => c.status === "active");

  useEffect(() => {
    if (!deployment.company_id) {
      setSupervisors([]);
      return;
    }
    fetchCoordinatorData(`supervisors?company_id=${deployment.company_id}`)
      .then((r) => setSupervisors(r.supervisors ?? []))
      .catch(() => setSupervisors([]));
  }, [deployment.company_id]);

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
    if (!deployment.company_id || !deployment.start_date || !deployment.required_hours) {
      setError("Select a company, start date, and required hours.");
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
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Add an intern</h3>
          <span className="text-xs font-medium text-slate-400">Step {step} of 2</span>
        </div>
        {lockedCompanyName && <p className="mt-1 text-sm text-slate-500">Deploying to {lockedCompanyName}</p>}

        {step === 1 ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">First name</span>
                <input value={account.first_name} onChange={(e) => setAccount((f) => ({ ...f, first_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Last name</span>
                <input value={account.last_name} onChange={(e) => setAccount((f) => ({ ...f, last_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
              <input type="email" value={account.email} onChange={(e) => setAccount((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="intern@example.com" />
              <span className="mt-1 block text-xs text-slate-400">They&apos;ll get an email here to set their own password and activate the account.</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Student number</span>
                <input value={account.student_number} onChange={(e) => setAccount((f) => ({ ...f, student_number: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Year level</span>
                <select value={account.year_level} onChange={(e) => setAccount((f) => ({ ...f, year_level: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  <option value="">Select year level…</option>
                  {YEAR_LEVEL_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Course</span>
              <select
                value={account.course}
                onChange={(e) => {
                  const course = e.target.value;
                  setAccount((f) => ({ ...f, course }));
                  setDeployment((f) => ({ ...f, required_hours: defaultHoursForCourse(course) }));
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Select course…</option>
                {COURSE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other</option>
              </select>
            </label>
            {account.course === "Other" && (
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Program name</span>
                <input value={account.course_other} onChange={(e) => setAccount((f) => ({ ...f, course_other: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. BS Marine Transportation" />
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
                    <select value={deployment.company_id} onChange={(e) => setDeployment((f) => ({ ...f, company_id: e.target.value, supervisor_id: "" }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                      <option value="">Select a company…</option>
                      {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Supervisor</span>
                  <select value={deployment.supervisor_id} onChange={(e) => setDeployment((f) => ({ ...f, supervisor_id: e.target.value }))} disabled={!deployment.company_id} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
                    <option value="">No supervisor assigned yet</option>
                    {supervisors.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Start date</span>
                  <input type="date" value={deployment.start_date} onChange={(e) => setDeployment((f) => ({ ...f, start_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-semibold text-slate-700">Required hours</span>
                  <input type="number" min="1" value={deployment.required_hours} onChange={(e) => setDeployment((f) => ({ ...f, required_hours: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. 500" />
                  <span className="mt-1 block text-xs text-slate-400">Prefilled from the intern&apos;s course — adjust if this intern needs a different total.</span>
                </label>
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
