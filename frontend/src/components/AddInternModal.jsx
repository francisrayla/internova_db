"use client";

import { useState } from "react";
import Link from "next/link";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { apiFetch } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import EmailField from "@/components/EmailField";
import { emailProblem, normalizeEmail } from "@/lib/emailCheck";
import { YEAR_LEVEL_OPTIONS } from "@/lib/internOptions";
import { hoursForOffered, useSchoolCourses } from "@/lib/schoolCourses";
import { START_DATE_HINT, startDateBounds } from "@/lib/startDateWindow";
import { Btn, SheetFrame } from "@/components/dash/page";

const EMPTY_ACCOUNT = { first_name: "", last_name: "", email: "", course: "", year_level: "4th Year" };

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
  const [attempted, setAttempted] = useState(false);
  const courses = useSchoolCourses();

  const activeCompanies = (companies ?? []).filter((c) => c.status === "active");

  function validateStep1() {
    if (!account.first_name.trim() || !account.last_name.trim()) return "Enter the intern's full name.";
    if (!account.email.trim()) return "Enter the intern's email address.";
    if (emailProblem(account.email)) return " ";
    if (!account.course) return "Choose the intern's course.";
    return "";
  }

  function goToStep2() {
    setAttempted(true);
    const err = validateStep1();
    if (err) return setError(err.trim());
    setError("");
    setStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!deployment.company_id || !deployment.start_date) {
      setError("Select a company and a start date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/interns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...account, email: normalizeEmail(account.email), ...deployment }),
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
      <SheetFrame
        title="Invitation sent"
        zIndex={60}
        footer={<Btn variant="primary" onClick={onSaved}>Done</Btn>}
      >
        <p className="dash-note">
          We emailed <strong>{account.email}</strong> a link to set their own password and activate their account.
        </p>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      title="Add an intern"
      description={lockedCompanyName ? `Deploying to ${lockedCompanyName}` : undefined}
      aside={`Step ${step} of 2`}
      onClose={saving ? undefined : onClose}
      size="md"
      zIndex={60}
      onSubmit={step === 2 ? handleSubmit : undefined}
      footer={
        step === 1 ? (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={goToStep2} disabled={courses.loading || courses.offered.length === 0}>Next: Deployment</Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => setStep(1)}>Back</Btn>
            <Btn variant="primary" type="submit" disabled={saving || (!lockedCompanyId && activeCompanies.length === 0)}>{saving ? "Sending invite…" : "Deploy & send invite"}</Btn>
          </>
        )
      }
    >
        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="k-field">
                <span className="k-label">First name</span>
                <input {...inputProps("personName")} value={account.first_name} onChange={(e) => setAccount((f) => ({ ...f, first_name: clean("personName", e.target.value) }))} className="k-input" />
              </label>
              <label className="k-field">
                <span className="k-label">Last name</span>
                <input {...inputProps("personName")} value={account.last_name} onChange={(e) => setAccount((f) => ({ ...f, last_name: clean("personName", e.target.value) }))} className="k-input" />
              </label>
            </div>
            <EmailField
              value={account.email}
              onChange={(email) => setAccount((f) => ({ ...f, email }))}
              showErrors={attempted}
              placeholder="intern@example.com"
              help="They'll get an email here to set their password and enter their own student number."
            />
            {courses.loading ? (
              <p className="text-sm text-slate-600" role="status">Loading your school&apos;s courses…</p>
            ) : courses.error ? (
              <p className="k-note is-risk" role="alert">{courses.error}</p>
            ) : courses.offered.length === 0 ? (
              <p className="k-note is-warn">
                <span>
                  Your school hasn&apos;t set up its courses yet. Only the courses your school offers can be picked here.{" "}
                  <Link href="/coordinator/settings/courses" className="font-semibold underline">Open Settings, Courses offered</Link>.
                </span>
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="k-field">
                  <span className="k-label">Course</span>
                  <select
                    value={account.course}
                    onChange={(e) => setAccount((f) => ({ ...f, course: e.target.value }))}
                    className="k-input"
                  >
                    <option value="">Select course…</option>
                    {courses.offered.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                <label className="k-field">
                  <span className="k-label">Year level</span>
                  <select value={account.year_level} onChange={(e) => setAccount((f) => ({ ...f, year_level: e.target.value }))} className="k-input">
                    {YEAR_LEVEL_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
              </div>
            )}

            {error && <p className="k-note is-risk" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {!lockedCompanyId && activeCompanies.length === 0 ? (
              <p className="k-note is-warn">You don&apos;t have any active partner companies yet. Add one from the Companies screen first.</p>
            ) : (
              <>
                {lockedCompanyId ? (
                  <div className="k-field">
                    <span className="k-label">Company</span>
                    <p className="k-input" aria-readonly="true" style={{ background: "var(--ui-soft)" }}>{lockedCompanyName}</p>
                  </div>
                ) : (
                  <label className="k-field">
                    <span className="k-label">Company</span>
                    <select value={deployment.company_id} onChange={(e) => setDeployment((f) => ({ ...f, company_id: e.target.value }))} className="k-input">
                      <option value="">Select a company…</option>
                      {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </label>
                )}
                <CompanySupervisorsNote companyId={deployment.company_id} companyName={lockedCompanyName ?? activeCompanies.find((c) => String(c.id) === String(deployment.company_id))?.company_name} />
                <label className="k-field">
                  <span className="k-label">Start date</span>
                  <input type="date" value={deployment.start_date} min={startDateBounds().min} max={startDateBounds().max} onChange={(e) => setDeployment((f) => ({ ...f, start_date: e.target.value }))} className="k-input" />
                  <span className="k-hint">{START_DATE_HINT}</span>
                </label>
                <div className="k-field">
                  <span className="k-label">Required hours</span>
                  <p className="k-input font-semibold" aria-readonly="true" style={{ background: "var(--ui-soft)" }}>
                    {hoursForOffered(courses.offered, courses.canonical, account.course)} hours
                  </p>
                  <span className="k-hint">
                    Set by your school for {account.course || "the intern's course"} (Settings, Courses offered) — not editable here.
                  </span>
                </div>
              </>
            )}

            {error && <p className="k-note is-risk" role="alert">{error}</p>}
          </div>
        )}
    </SheetFrame>
  );
}
