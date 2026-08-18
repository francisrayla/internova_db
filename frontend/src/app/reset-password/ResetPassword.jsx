"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ResetPassword() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!token || !email) {
      setError("This reset link is missing information. Please request a new one.");
      return;
    }
    if (!form.password || !form.confirmPassword) {
      setError("Please fill in both password fields.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          token,
          password: form.password,
          password_confirmation: form.confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not reset your password.");
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!token || !email) {
    return (
      <section className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-700">This reset link is invalid. Please request a new one.</p>
          <Link href="/forgot-password" className="text-sm font-medium text-blue-700">Request a new link</Link>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm font-medium text-emerald-700">Your password was reset successfully. You can now log in with it.</p>
          <Link href="/login" className="action-button justify-center">Go to Login</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Password setup</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Create a new password</h1>
          <p className="mt-2 text-sm text-slate-600">Choose a strong password for <strong>{email}</strong> and confirm it before saving.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700">
            New password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="At least 8 characters"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Confirm password
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="Re-enter password"
            />
          </label>
          <button type="submit" disabled={saving} className="action-button w-full justify-center disabled:opacity-60">
            {saving ? "Saving…" : "Save password"}
          </button>
        </form>

        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

        <Link href="/login" className="text-sm font-medium text-slate-700">
          Back to login
        </Link>
      </div>
    </section>
  );
}
