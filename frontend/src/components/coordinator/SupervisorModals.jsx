"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmailField from "@/components/EmailField";
import { Btn, FormField, Input, Select, SheetFrame } from "@/components/dash/page";
import { emailProblem, normalizeEmail, serverFieldError } from "@/lib/emailCheck";

export function AddSupervisorModal({ companyId, companyName, onClose, onSaved }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", position: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Enter the supervisor's full name.");
    if (!form.email.trim()) return setError("Enter the supervisor's email address.");
    if (emailProblem(form.email)) return setError("");

    setSaving(true);
    setError("");
    setEmailError("");
    try {
      const res = await apiFetch("/api/coordinator/supervisors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: normalizeEmail(form.email), company_id: companyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const fieldMessage = serverFieldError(data, "email");
        if (fieldMessage) return setEmailError(fieldMessage);
        throw new Error(data.message || "Could not add supervisor.");
      }
      setCreated({ email: data.email });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <SheetFrame title="Invitation sent" zIndex={60} footer={<Btn variant="primary" onClick={onSaved}>Done</Btn>}>
        <div className="space-y-3">
          <p className="break-words text-sm text-slate-600">
            Invitation sent to <span className="font-medium text-slate-900">{created.email}</span>. They will set their own password from the link.
          </p>
          <p className="k-note">
            Until they open the link the supervisor shows as Pending and cannot sign in. If the email does not arrive, use Resend invitation or Change email in the supervisor&apos;s menu.
          </p>
        </div>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      onClose={onClose}
      title="Add a supervisor"
      description={`At ${companyName}`}
      zIndex={60}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Sending…" : "Send invitation"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name">
            <Input {...inputProps("personName")} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} />
          </FormField>
          <FormField label="Last name">
            <Input {...inputProps("personName")} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} />
          </FormField>
        </div>
        <EmailField
          value={form.email}
          onChange={(email) => { setForm((f) => ({ ...f, email })); setEmailError(""); }}
          serverError={emailError}
          showErrors={attempted}
          placeholder="supervisor@example.com"
          help="Their sign-in email. We email them a link to set their own password."
        />
        <FormField label="Position">
          <Select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}>
            <option value="">Select position…</option>
            <option value="Staff">Staff</option>
            <option value="Supervisor">Supervisor</option>
          </Select>
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);
  // Someone who has not set up their account yet is re-invited through "Change email" instead.
  const awaitingSetup = supervisor.status === "pending" || supervisor.status === "bounced";

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Enter the supervisor's full name.");
    if (!form.email.trim()) return setError("Enter the supervisor's email address.");
    if (emailProblem(form.email)) return setError("");

    setSaving(true);
    setError("");
    setEmailError("");
    try {
      const res = await apiFetch(`/api/coordinator/supervisors/${supervisor.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: normalizeEmail(form.email) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const fieldMessage = serverFieldError(data, "email");
        if (fieldMessage) {
          setEmailError(fieldMessage);
          setSaving(false);
          return;
        }
        throw new Error(data.message || "Could not update supervisor.");
      }
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
    <SheetFrame
      onClose={onClose}
      title="Edit supervisor"
      zIndex={60}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn variant="danger-quiet" className="sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={saving}>Delete</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
        </>
      }
    >
      <ConfirmDialog open={confirmDelete} title={`Delete ${supervisor.name}?`} confirmLabel="Delete supervisor" busy={saving} error={error} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)}>
        <p>They are removed from this company and can no longer log in. If they already assigned tasks, gave evaluations or reviewed attendance, that history is kept under their name; a supervisor with no history is deleted completely. A company always needs at least one supervisor.</p>
      </ConfirmDialog>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name">
            <Input {...inputProps("personName")} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} />
          </FormField>
          <FormField label="Last name">
            <Input {...inputProps("personName")} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} />
          </FormField>
        </div>
        <EmailField
          value={form.email}
          onChange={(email) => { setForm((f) => ({ ...f, email })); setEmailError(""); }}
          serverError={emailError}
          showErrors={attempted}
          disabled={awaitingSetup}
          help={awaitingSetup ? "Not set up yet. To change the email, close this and use Change email so a new invitation is sent." : null}
        />
        <FormField label="Position">
          <Select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}>
            <option value="">Select position…</option>
            <option value="Staff">Staff</option>
            <option value="Supervisor">Supervisor</option>
          </Select>
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
    <SheetFrame
      onClose={onClose}
      title="Which company is this supervisor for?"
      description={`Each company can have up to ${MAX_SUPERVISORS} supervisors.`}
      zIndex={60}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!companyId} onClick={() => onChoose(companies.find((c) => String(c.id) === companyId))}>Continue</Btn>
        </>
      }
    >
      {companies.length === 0 ? (
        <p className="k-note is-warn">Add a partner company first, then you can add its supervisors.</p>
      ) : (
        <div className="space-y-3">
          {available.length === 0 ? (
            <p className="k-note">
              Every company already has its {MAX_SUPERVISORS} supervisors. To bring in someone new, open the company and edit one of its supervisors to replace them.
            </p>
          ) : (
            <FormField label="Company">
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Select a company…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name} ({c.supervisors_count ?? 0} of {MAX_SUPERVISORS})</option>
                ))}
              </Select>
            </FormField>
          )}
          {full.length > 0 && available.length > 0 && (
            <p className="k-hint">
              Not listed because they already have {MAX_SUPERVISORS} supervisors: {full.map((c) => c.company_name).join(", ")}. Edit one of their supervisors to replace them.
            </p>
          )}
        </div>
      )}
    </SheetFrame>
  );
}
