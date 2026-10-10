"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";
import PasswordInput from "@/components/PasswordInput";
import { FormField, Input, Page, PageHeader, Section } from "@/components/dash/page";

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
      if (res.status === 429) {
        // Laravel's own "Too Many Attempts." is not a sentence for a person: say what to do.
        const wait = Number(res.headers.get("Retry-After")) || 60;
        throw new Error(`Too many attempts. Please wait about ${wait} seconds and try again.`);
      }
      const data = await res.json().catch(() => ({}));
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
    <Page size="narrow" className="mx-0">
      <PageHeader title="Account and password" sentence="Manage your login. Your email is how you sign in." />

      <Section>
        <div className="grid gap-5">
          <FormField label="Email">
            <Input type="email" value={user?.email ?? ""} disabled />
          </FormField>

          <form onSubmit={handleSubmit} className="grid gap-5">
            <FormField label="Current password">
              <PasswordInput
                value={form.current_password}
                onChange={(e) => handleChange("current_password", e.target.value)}
                placeholder="••••••••"
                maxLength={72}
                className="k-input"
              />
            </FormField>
            <FormField label="New password">
              <PasswordInput
                value={form.new_password}
                onChange={(e) => handleChange("new_password", e.target.value)}
                placeholder="At least 8 characters"
                maxLength={72}
                className="k-input"
              />
            </FormField>
            <FormField label="Confirm new password">
              <PasswordInput
                value={form.new_password_confirmation}
                onChange={(e) => handleChange("new_password_confirmation", e.target.value)}
                placeholder="••••••••"
                maxLength={72}
                className="k-input"
              />
            </FormField>

            {error && <p role="alert" className="k-note is-risk">{error}</p>}
            {success && <p role="status" className="k-note is-ok">{success}</p>}

            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="k-btn is-primary max-sm:w-full">
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </Section>
    </Page>
  );
}
