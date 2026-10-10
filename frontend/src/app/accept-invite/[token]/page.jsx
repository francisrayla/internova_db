"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TriangleAlert, CircleCheck, GraduationCap } from "lucide-react";
import PasswordInput from "@/components/PasswordInput";
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
  const [done, setDone] = useState(false);

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

    setSaving(true);
    fetch(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        password_confirmation: confirm,
        ...(invite.needs_student_number ? { student_number: studentNumber } : {}),
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to activate account.");
        return data;
      })
      .then(() => setDone(true))
      .catch((err) => setSubmitError(err.message))
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
          <p className="mt-2 text-xs text-slate-400">If you believe this is a mistake, please contact your Internova account manager for a new invitation.</p>
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

          {submitError && (
            <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{submitError}</p>
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
