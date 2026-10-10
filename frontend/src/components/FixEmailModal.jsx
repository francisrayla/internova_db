"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import EmailField from "@/components/EmailField";
import { Btn, SheetFrame } from "@/components/dash/page";
import { emailProblem, normalizeEmail, serverFieldError } from "@/lib/emailCheck";

/**
 * For an invited intern or supervisor whose invitation email bounced:
 * correct the address and send the invitation again in one step.
 */
export default function FixEmailModal({ userId, name, currentEmail, onClose, onFixed }) {
  const [email, setEmail] = useState(currentEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    if (!email.trim()) {
      setError("Enter the correct email address.");
      return;
    }
    if (emailProblem(email)) {
      setError("");
      return;
    }
    if (normalizeEmail(email) === (currentEmail ?? "").toLowerCase()) {
      setError("This is the same email. Change it, or close this and use Resend invitation.");
      return;
    }
    setSaving(true);
    setError("");
    setEmailError("");
    try {
      const res = await apiFetch(`/api/coordinator/users/${userId}/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeEmail(email) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const fieldMessage = serverFieldError(data, "email");
        if (fieldMessage) {
          setEmailError(fieldMessage);
          setSaving(false);
          return;
        }
        throw new Error(data.message || "Could not update the email.");
      }
      onFixed(normalizeEmail(email));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      onClose={saving ? undefined : onClose}
      title="Edit email & resend invite"
      description={
        <>
          {name} has not set up their account yet. The invitation went to <span className="font-medium text-slate-800">{currentEmail}</span>.
          If that is a mistake, enter the correct email and a new link is sent there. The old link stops working.
        </>
      }
      zIndex={60}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Sending…" : "Save & resend invite"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <EmailField
          label="Correct email"
          value={email}
          onChange={(v) => { setEmail(v); setEmailError(""); }}
          serverError={emailError}
          showErrors={attempted}
          lowercase
          autoFocus
        />
        {error && <p role="alert" className="k-note is-risk">{error}</p>}
      </div>
    </SheetFrame>
  );
}
