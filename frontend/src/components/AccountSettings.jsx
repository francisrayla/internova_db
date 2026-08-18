"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";

/**
 * Password change, same shared /api/auth/change-password endpoint for every
 * role — this was previously copy-pasted per role; consolidated here since
 * the form and logic were already word-for-word identical.
 */
export default function AccountSettings() {
  const { user } = useCurrentUser();
  const [form, setForm] = useState({ current_password: "", new_password: "", new_password_confirmation: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.current_password || !form.new_password || !form.new_password_confirmation) {
      setError("Please fill in all three fields.");
      return;
    }
    if (form.new_password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (form.new_password !== form.new_password_confirmation) {
      setError("New password and confirmation don't match.");
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
          new_password_confirmation: form.new_password_confirmation,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update your password.");
      setSuccess(data.message || "Password updated.");
      setForm({ current_password: "", new_password: "", new_password_confirmation: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Account Settings</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Manage your login and preferences</h2>
      </section>

      <section className="max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
          <input type="email" value={user?.email ?? ""} disabled className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500" />
        </label>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Current Password</span>
            <input
              type="password"
              value={form.current_password}
              onChange={(e) => handleChange("current_password", e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">New Password</span>
            <input
              type="password"
              value={form.new_password}
              onChange={(e) => handleChange("new_password", e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Confirm New Password</span>
            <input
              type="password"
              value={form.new_password_confirmation}
              onChange={(e) => handleChange("new_password_confirmation", e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          {success && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </section>
    </div>
  );
}
