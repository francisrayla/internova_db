"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";
import { readStoredUser, resolveDashboardPath, resolveLandingPath } from "@/lib/roleDashboard";
import { clearOfflineCaches } from "@/lib/offlineCache";

import { clean, inputProps } from "@/lib/inputRules";
export default function Login() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  // Why the user was sent back here (apiFetch adds ?reason=expired when the server ended their session).
  const [notice, setNotice] = useState("");

  // Already signed in (e.g. reopened the installed app, or just navigated
  // back here) — skip straight to the dashboard instead of making them look
  // at a login form for an account they're already in.
  useEffect(() => {
    let cancelled = false;
    resolveLandingPath(readStoredUser()).then((landingPath) => {
      if (cancelled) return;
      if (landingPath) router.replace(landingPath);
      else {
        if (new URLSearchParams(window.location.search).get("reason") === "expired") {
          setNotice("Your session has ended, so we signed you out to keep your account safe. Please sign in again.");
        }
        setCheckingSession(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.email || !form.password) {
      setError("Please enter both your email and password.");
      return;
    }

    if (!/\S+@\S+\.\S+/.test(form.email)) {
      setError("Please use a valid email address.");
      return;
    }

    setSigningIn(true);
    setMessage("Signing in…");

    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          if (data.needsVerification) {
            router.push(`/verify-email?email=${encodeURIComponent(form.email)}`);
            return null;
          }
          throw new Error(data.message || "Invalid email or password.");
        }
        return data;
      })
      .then(async (data) => {
        if (!data) return;
        const { user, token } = data;
        await clearOfflineCaches();
        localStorage.setItem("internova_user", JSON.stringify(user));
        localStorage.setItem("internova_token", token);

        router.push(resolveDashboardPath(user) ?? "/");
      })
      .catch((err) => {
        setSigningIn(false);
        setMessage("");
        setError(err.message);
      });
  }

  if (checkingSession) return null;

  return (
    <section className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <Logo size={36} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Authentication</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sign in to Internova</h1>
          <p className="mt-2 text-sm text-slate-600">Use this screen to enter the workspace and continue to your dashboard.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input {...inputProps("email")}
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: clean("email", event.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <PasswordInput
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="Enter password"
              maxLength={72}
            />
          </label>
          <button type="submit" disabled={signingIn} className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {signingIn ? "Signing in…" : "Login"}
          </button>
        </form>

        {notice && !error && !message ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{notice}</p> : null}
        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        {!error && message ? <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p> : null}

        <p className="text-xs text-slate-500">
          Registering your school for the first time?{" "}
          <Link href="/inquiry" className="font-medium text-blue-700">Register here</Link>.
        </p>

        <div className="text-sm">
          <Link href="/forgot-password" className="font-medium text-blue-700">
            Forgot password?
          </Link>
        </div>

        <Link href="/" className="text-center text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Back to Home
        </Link>
      </div>
    </section>
  );
}
