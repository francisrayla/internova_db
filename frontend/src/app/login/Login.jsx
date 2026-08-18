"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";

const ROLE_DASHBOARD = {
  super_admin: "/superadmin/dashboard",
  coordinator: "/coordinator/dashboard",
  supervisor: "/supervisor/dashboard",
  intern: "/intern/dashboard",
};

export default function Login() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

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
        if (!res.ok || !data.success) throw new Error(data.message || "Invalid email or password.");
        return data;
      })
      .then(({ user, token }) => {
        localStorage.setItem("internova_user", JSON.stringify(user));
        localStorage.setItem("internova_token", token);

        if (user.role === "coordinator") {
          if (user.status === "pending_approval") {
            router.push("/coordinator/pending");
          } else if (user.subscription_status !== "active") {
            router.push("/coordinator/subscription");
          } else {
            router.push("/coordinator/dashboard");
          }
          return;
        }

        router.push(ROLE_DASHBOARD[user.role] ?? "/");
      })
      .catch((err) => {
        setSigningIn(false);
        setMessage("");
        setError(err.message);
      });
  }

  return (
    <section className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <Logo size={36} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Authentication</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sign in to Internova AI</h1>
          <p className="mt-2 text-sm text-slate-600">Use this screen to enter the workspace and continue to your dashboard.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="Enter password"
            />
          </label>
          <button type="submit" disabled={signingIn} className="action-button w-full justify-center disabled:opacity-60">
            {signingIn ? "Signing in…" : "Continue to dashboard"}
          </button>
        </form>

        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        {!error && message ? <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p> : null}

        <p className="text-xs text-slate-500">
          Registering your school for the first time?{" "}
          <Link href="/inquiry" className="font-medium text-blue-700">Register here</Link>.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link href="/forgot-password" className="font-medium text-blue-700">
            Forgot password?
          </Link>
          <Link href="/reset-password" className="font-medium text-slate-700">
            Reset password
          </Link>
        </div>

        <Link href="/" className="text-center text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Back to Home
        </Link>
      </div>
    </section>
  );
}
