"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TriangleAlert, CircleCheck, GraduationCap } from "lucide-react";
import PasswordInput from "@/components/PasswordInput";
import TermsCheckbox from "@/components/TermsCheckbox";
import { clean, inputProps } from "@/lib/inputRules";

const ROLE_LABELS = { dean: "Dean", coordinator: "coordinator", supervisor: "supervisor", intern: "intern" };

export default function AcceptInvitePage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [done, setDone] = useState(false);
  const [alreadyUsed, setAlreadyUsed] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "This invitation link is invalid or has expired.");
        return data;
      })
      .then(setInvite)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setTermsError("");

    if (invite.needs_student_number && !studentNumber.trim()) {
      setSubmitError("Enter your student number.");
      return;
    }
    if (password.length < 8) {
      setSubmitError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setSubmitError("Passwords do not match.");
      return;
    }
    if (!acceptTerms) {
      setTermsError("You need to agree to the Terms and Conditions and the Privacy Notice to activate your account.");
      return;
    }

    setSaving(true);
    setAlreadyUsed(false);
    fetch(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Never leave the button on "Activating…" forever: give up after 30 s and let the person try again.
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        password,
        password_confirmation: confirm,
        accept_terms: acceptTerms,
        ...(invite.needs_student_number ? { student_number: studentNumber } : {}),
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        // The link was used up — most often by the first tap that seemed to hang but went through.
        if (res.status === 404) {
          setAlreadyUsed(true);
          throw new Error("This invitation link has already been used. If you just activated your account, log in with your new password.");
        }
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to activate account.");
        return data;
      })
      .then(() => setDone(true))
      .catch((err) => {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        setSubmitError(
          timedOut
            ? "This is taking longer than usual. Check your connection, then tap Activate My Account again."
            : err instanceof TypeError
              ? "Could not reach Internova. Check your connection, then tap Activate My Account again."
              : err.message
        );
      })
      .finally(() => setSaving(false));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">Checking your invitation…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-xl text-center">
          <TriangleAlert className="mx-auto h-12 w-12 text-amber-600" aria-hidden="true" />
          <h1 className="mt-5 text-xl font-bold text-slate-900">Invitation Not Available</h1>
          <p className="mt-3 text-slate-600 text-sm">{loadError}</p>
          <p className="mt-2 text-xs text-slate-400">If you got more than one invitation email, open the newest one. Otherwise ask the person who invited you (your school or coordinator) to send a new invitation.</p>
          <Link href="/" className="mt-6 inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-xl text-center">
          <CircleCheck className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-5 text-2xl font-bold text-slate-900">Account Activated!</h1>
          <p className="mt-3 text-slate-600 text-sm">
            Welcome, <strong>{invite.first_name}</strong>! Your {ROLE_LABELS[invite.role] ?? "Internova"} account
            {invite.school_name ? <> for <strong>{invite.school_name}</strong></> : null} is ready.
          </p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 mb-4">
            <GraduationCap className="h-4 w-4" aria-hidden="true" /> Internova
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome, {invite.first_name}!</h1>
          <p className="mt-2 text-sm text-slate-600">
            {invite.needs_student_number ? "Add your student number and set a password" : "Set a password"} to activate your {ROLE_LABELS[invite.role] ?? "Internova"} account
            {invite.school_name ? <> for <strong>{invite.school_name}</strong></> : null}.
          </p>
        </div>

        <div className="mb-4 rounded-xl bg-slate-50 px-4 py-2 text-sm text-center">
          <span className="text-slate-500">Logging in as </span>
          <span className="font-medium text-slate-900">{invite.email}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {invite.needs_student_number && (
            <div>
              <label htmlFor="student-number" className="block text-xs font-semibold text-slate-600 mb-1">Student Number</label>
              <input
                id="student-number"
                {...inputProps("studentNumber")}
                value={studentNumber}
                onChange={(e) => setStudentNumber(clean("studentNumber", e.target.value))}
                required
                placeholder="e.g. 2022-00123"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-400">Your school ID number. Only you, your coordinator and your supervisor can see it.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">New Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={72}
              required
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Confirm Password</label>
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              maxLength={72}
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <TermsCheckbox checked={acceptTerms} onChange={(v) => { setAcceptTerms(v); if (v) setTermsError(""); }} error={termsError} />

          {submitError && (
            <div role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
              <p>{submitError}</p>
              {alreadyUsed && (
                <Link href="/login" className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline">
                  Go to Login
                </Link>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Activating…" : "Activate My Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
