"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import EmailField from "@/components/EmailField";
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
    <div className="sheet-overlay fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <form onSubmit={handleSubmit} className="sheet-panel w-full max-w-md rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Edit email &amp; resend invite</h3>
        <p className="mt-1 text-sm text-slate-600">
          {name} has not set up their account yet. The invitation went to <span className="font-medium text-slate-800">{currentEmail}</span>.
          If that is a mistake, enter the correct email and a new link is sent there. The old link stops working.
        </p>
        <div className="mt-4">
          <EmailField
            label="Correct email"
            value={email}
            onChange={(v) => { setEmail(v); setEmailError(""); }}
            serverError={emailError}
            showErrors={attempted}
            lowercase
            autoFocus
          />
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Sending…" : "Save & resend invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
