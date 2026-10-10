"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { clean, inputProps } from "@/lib/inputRules";
import useResendCooldown, { formatCountdown } from "@/lib/useResendCooldown";

export default function VerifyEmail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState("");
  const cooldown = useResendCooldown("verify", email);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "That code is incorrect or has expired.");
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleResend() {
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Enter your email first.");
      return;
    }
    setError("");
    setNotice("");
    setSending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        // Rate limit: show the server's friendly "please wait about N seconds" text.
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Too many requests. Please wait a moment and try again.");
      }
      if (!res.ok) throw new Error();
      cooldown.start();
      setCode("");
      setNotice(`A new code is on its way to ${email}. Only the newest code works.`);
    } catch (err) {
      setError(err?.message || "Couldn't send a new code. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        {done ? (
          <div className="space-y-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Email verified</p>
            <h1 className="text-2xl font-semibold text-slate-900">You&apos;re all set!</h1>
            <p className="text-sm text-slate-600">You can now log in to your account.</p>
            <button type="button" onClick={() => router.push("/login")} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
              Go to login
            </button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Verify your email</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Enter your code</h1>
              <p className="mt-2 text-sm text-slate-600">
                We sent a 6-digit code to your email when you registered. It expires in 15 minutes.
              </p>
              <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Can&apos;t find it? Check your <strong>Spam</strong> or <strong>Promotions</strong> folder for
                &ldquo;Verify your email for Internova&rdquo;. If it&apos;s there, mark it as <strong>Not spam</strong> so
                our next emails reach your inbox.
              </p>
            </div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-slate-700">
                Email
                <input {...inputProps("email")}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(clean("email", event.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="you@example.com"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Verification code
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
                {sending ? "Verifying…" : "Verify email"}
              </button>
            </form>
            {cooldown.remaining > 0 ? (
              <p className="text-center text-sm text-slate-500" aria-live="polite">
                You can request a new code in <span className="font-semibold tabular-nums text-slate-700">{formatCountdown(cooldown.remaining)}</span>
              </p>
            ) : (
              <button type="button" onClick={handleResend} disabled={sending} className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-60">
                Resend code
              </button>
            )}
          </>
        )}

        {notice && !error ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700" role="status">
            {notice} Give it a minute, and check Spam or Promotions too.
          </p>
        ) : null}

        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

        {!done && (
          <Link href="/login" className="text-sm font-medium text-slate-700">
            Back to login
          </Link>
        )}
      </div>
    </section>
  );
}
