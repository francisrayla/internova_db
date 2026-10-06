"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { clampOnBlur } from "@/lib/clampNumber";
import { cleanNumber } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { todayLocalDate } from "@/lib/timeAgo";

/**
 * Two separate actions:
 * - Updating hours/start date edits the deployment in place.
 * - Reassigning to a different company ALSO edits the same deployment in place (the
 *   intern stays one row; attendance, journal, tasks and hours stay with them and the
 *   move is recorded in their transfer history).
 */
export default function ManageDeploymentModal({ intern, currentCompanyId, onClose, onSaved }) {
  const [hoursForm, setHoursForm] = useState({ required_hours: intern.required_hours, start_date: intern.start_date_raw ?? "" });
  const [savingHours, setSavingHours] = useState(false);
  const [hoursError, setHoursError] = useState("");

  const [companies, setCompanies] = useState([]);
  const [reassignForm, setReassignForm] = useState({ company_id: "", transferred_on: todayLocalDate() });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState("");

  useEffect(() => {
    fetchCoordinatorData("companies").then((r) => setCompanies(r.companies ?? [])).catch(() => setCompanies([]));
  }, []);

  const otherActiveCompanies = companies.filter((c) => c.status === "active" && String(c.id) !== String(currentCompanyId));
  const newCompany = companies.find((c) => String(c.id) === String(reassignForm.company_id));

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

  function askReassign(e) {
    e.preventDefault();
    if (!reassignForm.company_id || !reassignForm.transferred_on) {
      setReassignError("Select a company and the date they move.");
      return;
    }
    setReassignError("");
    setConfirmOpen(true);
  }

  async function handleReassign() {
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
      setConfirmOpen(false);
      onSaved();
    } catch (err) {
      setReassignError(err.message);
    } finally {
      setReassigning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Manage deployment</h3>
        <p className="mt-1 text-sm text-slate-500">{intern.intern_name} — currently at {intern.company_name}</p>

        <form onSubmit={handleUpdateHours} className="mt-5 space-y-3 rounded-2xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Update deployment details</p>
            <p className="text-xs text-slate-500">Adjust hours or the start date. Supervisors are not picked per intern: everyone supervising at {intern.company_name} handles them.</p>
          </div>
          <CompanySupervisorsNote companyId={currentCompanyId} companyName={intern.company_name} />
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

        <form onSubmit={askReassign} className="mt-4 space-y-3 rounded-2xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Reassign to a different company</p>
            <p className="text-xs text-slate-500">Same deployment, new company. Their hours, attendance, journal and tasks stay with them and still count toward the total ({intern.hours_completed ?? 0} of {intern.required_hours} h so far). The move is saved in their deployment history.</p>
          </div>
          {otherActiveCompanies.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">No other active partner companies yet.</p>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">New company</span>
                <select value={reassignForm.company_id} onChange={(e) => setReassignForm((f) => ({ ...f, company_id: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  <option value="">Select a company…</option>
                  {otherActiveCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </label>
              <CompanySupervisorsNote companyId={reassignForm.company_id} companyName={newCompany?.company_name} />
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Moves on</span>
                <input type="date" value={reassignForm.transferred_on} min={intern.start_date_raw ?? undefined} onChange={(e) => setReassignForm((f) => ({ ...f, transferred_on: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
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
      <ConfirmDialog
        open={confirmOpen}
        title={`Move ${intern.intern_name} to ${newCompany?.company_name ?? "the new company"}?`}
        tone="primary"
        confirmLabel="Move intern"
        busy={reassigning}
        error={reassignError}
        onConfirm={handleReassign}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>Their hours, attendance and journal stay with them and count toward the total.</p>
        <p>
          They will show under {newCompany?.company_name ?? "the new company"} from now on, and no longer under {intern.company_name}, where they stay listed as &ldquo;Transferred out&rdquo;. {intern.company_name}&rsquo;s supervisors will no longer see them; the supervisors at the new company will.
        </p>
      </ConfirmDialog>
    </div>
  );
}
