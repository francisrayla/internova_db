"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { clampOnBlur } from "@/lib/clampNumber";
import { cleanNumber } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Btn, FormField, Input, Select, SheetFrame } from "@/components/dash/page";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { START_DATE_HINT, startDateBounds } from "@/lib/startDateWindow";
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
    <SheetFrame
      onClose={onClose}
      title="Manage deployment"
      description={`${intern.intern_name} — currently at ${intern.company_name}`}
      size="md"
      zIndex={60}
      footer={<Btn onClick={onClose}>Close</Btn>}
    >
      <div className="space-y-6">
        <form onSubmit={handleUpdateHours} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Update deployment details</h3>
            <p className="k-hint mt-0.5">Adjust hours or the start date. Supervisors are not picked per intern: everyone supervising at {intern.company_name} handles them.</p>
          </div>
          <CompanySupervisorsNote companyId={currentCompanyId} companyName={intern.company_name} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Required hours">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={hoursForm.required_hours}
                onChange={(e) => setHoursForm((f) => ({ ...f, required_hours: cleanNumber(e.target.value, { max: 2000 }) }))}
                onBlur={(e) => setHoursForm((f) => ({ ...f, required_hours: clampOnBlur(e.target.value, 1, 2000) }))}
              />
            </FormField>
            <FormField label="Start date" hint={START_DATE_HINT}>
              <Input type="date" value={hoursForm.start_date} min={[startDateBounds().min, intern.start_date_raw].filter(Boolean).sort()[0]} max={[startDateBounds().max, intern.start_date_raw].filter(Boolean).sort().at(-1)} onChange={(e) => setHoursForm((f) => ({ ...f, start_date: e.target.value }))} />
            </FormField>
          </div>
          {hoursError && <p className="k-note is-risk" role="alert">{hoursError}</p>}
          <div className="flex justify-end">
            <Btn variant="primary" type="submit" disabled={savingHours} className="max-sm:w-full">{savingHours ? "Saving…" : "Save"}</Btn>
          </div>
        </form>

        <form onSubmit={askReassign} className="space-y-3 border-t border-slate-200 pt-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Reassign to a different company</h3>
            <p className="k-hint mt-0.5">Same deployment, new company. Their hours, attendance, journal and tasks stay with them and still count toward the total ({intern.hours_completed ?? 0} of {intern.required_hours} h so far). The move is saved in their deployment history.</p>
          </div>
          {otherActiveCompanies.length === 0 ? (
            <p className="k-note is-warn">No other active partner companies yet.</p>
          ) : (
            <>
              <FormField label="New company">
                <Select value={reassignForm.company_id} onChange={(e) => setReassignForm((f) => ({ ...f, company_id: e.target.value }))}>
                  <option value="">Select a company…</option>
                  {otherActiveCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </Select>
              </FormField>
              <CompanySupervisorsNote companyId={reassignForm.company_id} companyName={newCompany?.company_name} />
              <FormField label="Moves on">
                <Input type="date" value={reassignForm.transferred_on} min={intern.start_date_raw ?? undefined} onChange={(e) => setReassignForm((f) => ({ ...f, transferred_on: e.target.value }))} />
              </FormField>
            </>
          )}
          {reassignError && <p className="k-note is-risk" role="alert">{reassignError}</p>}
          <div className="flex justify-end">
            <Btn type="submit" disabled={reassigning || otherActiveCompanies.length === 0} className="max-sm:w-full">
              {reassigning ? "Reassigning…" : "Reassign"}
            </Btn>
          </div>
        </form>
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
    </SheetFrame>
  );
}
