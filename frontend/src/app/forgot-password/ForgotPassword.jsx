"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";

import { clean, inputProps } from "@/lib/inputRules";
import useResendCooldown, { formatCountdown } from "@/lib/useResendCooldown";

// email -> code -> password -> done
const STEPS = { EMAIL: "email", CODE: "code", PASSWORD: "password", DONE: "done" };

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const cooldown = useResendCooldown("reset", email);

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setError("");

    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Something went wrong. Please try again.");
      // An email with no account (or one that cannot sign in) is answered with an error
      // above, so only a real account reaches the code step.
      cooldown.start();
      setStep(STEPS.CODE);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleCodeSubmit(event) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "That code is incorrect or has expired.");
      setStep(STEPS.PASSWORD);
    } catch (err) {
      // Wrong code — stay on this same step so they can just retry.
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password: form.password, password_confirmation: form.confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not reset your password. Please try again.");
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleResend() {
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      cooldown.start();
      setCode("");
    } catch {
      setError("Couldn't send a new code. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        {step === STEPS.EMAIL && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Password recovery</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Reset your password</h1>
              <p className="mt-2 text-sm text-slate-600">Enter your email and we&apos;ll send a 6-digit recovery code.</p>
            </div>
            <form className="space-y-4" onSubmit={handleEmailSubmit}>
              <label className="block text-sm font-medium text-slate-700">
                Email
                <input {...inputProps("email")}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(clean("email", event.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="you@example.com"
                  autoFocus
                />
              </label>
              <button type="submit" disabled={sending} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
                {sending ? "Sending…" : "Send recovery code"}
              </button>
            </form>
          </>
        )}

        {step === STEPS.CODE && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Password recovery</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Enter your code</h1>
              <p className="mt-2 text-sm text-slate-600">
                We sent a 6-digit code to <strong>{email}</strong>. It expires in 15 minutes. Check Spam or Promotions if you don&apos;t see it.
              </p>
            </div>
            <form className="space-y-4" onSubmit={handleCodeSubmit}>
              <label className="block text-sm font-medium text-slate-700">
                Recovery code
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center text-2xl font-semibold tracking-[0.5em] outline-none focus:border-blue-500"
                  placeholder="000000"
                  autoFocus
                />
              </label>
              <button type="submit" disabled={sending} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
                {sending ? "Verifying…" : "Verify code"}
              </button>
            </form>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => setStep(STEPS.EMAIL)} className="font-medium text-slate-700 hover:underline">
                ← Use a different email
              </button>
              {cooldown.remaining > 0 ? (
                <span className="text-slate-500" aria-live="polite">
                  Resend in <span className="font-semibold tabular-nums text-slate-700">{formatCountdown(cooldown.remaining)}</span>
                </span>
              ) : (
                <button type="button" onClick={handleResend} disabled={sending} className="font-medium text-blue-700 hover:underline disabled:opacity-60">
                  Resend code
                </button>
              )}
            </div>
          </>
        )}

        {step === STEPS.PASSWORD && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Password recovery</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Choose a new password</h1>
              <p className="mt-2 text-sm text-slate-600">Code verified — set a new password for your account.</p>
            </div>
            <form className="space-y-4" onSubmit={handlePasswordSubmit}>
              <label className="block text-sm font-medium text-slate-700">
                New password
                <PasswordInput
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="At least 8 characters"
                  maxLength={72}
                  autoFocus
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Confirm password
                <PasswordInput
                  value={form.confirmPassword}
                  onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="Re-enter password"
                  maxLength={72}
                />
              </label>
              <button type="submit" disabled={sending} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
                {sending ? "Saving…" : "Reset password"}
              </button>
            </form>
          </>
        )}

        {step === STEPS.DONE && (
          <div className="space-y-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Password recovery</p>
            <h1 className="text-2xl font-semibold text-slate-900">Password reset!</h1>
            <p className="text-sm text-slate-600">You can now log in with your new password.</p>
            <button type="button" onClick={() => router.push("/login")} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
              Back to login
            </button>
          </div>
        )}

        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

        {step !== STEPS.DONE && (
          <Link href="/login" className="text-sm font-medium text-slate-700">
            Back to login
          </Link>
        )}
      </div>
    </section>
  );
}
