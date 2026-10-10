"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/apiFetch";
import { Btn, FormField, Input, SheetFrame } from "@/components/dash/page";

import { clean, inputProps } from "@/lib/inputRules";
// Same portal-to-<body> reasoning as AvatarUploadModal: the header's
// backdrop-blur creates a new containing block, so a non-portalled modal
// would render clipped near the header instead of centered on the viewport.
export default function EditProfileModal({ user, onClose, onUpdated }) {
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (phone && phone.length !== 11) {
      setError("Phone number must be exactly 11 digits.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update your profile.");
      onUpdated(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <SheetFrame
      title="Edit profile"
      description="Your email stays the same. Contact support if that needs to change."
      onClose={onClose}
      onSubmit={handleSubmit}
      zIndex={120}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <button type="submit" disabled={saving} className="k-btn is-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="mt-2 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name">
            <Input {...inputProps("personName")}
              value={firstName}
              onChange={(e) => setFirstName(clean("personName", e.target.value))}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Last name">
            <Input {...inputProps("personName")}
              value={lastName}
              onChange={(e) => setLastName(clean("personName", e.target.value))}
              required
            />
          </FormField>
        </div>
        <FormField label="Phone number (optional)" hint="11 digits, e.g. 09171234567.">
          <Input {...inputProps("phone")}
            value={phone}
            onChange={(e) => setPhone(clean("phone", e.target.value))}
            type="tel"
            inputMode="numeric"
            placeholder="09171234567"
          />
        </FormField>
        {error && <p role="alert" className="k-note is-risk">{error}</p>}
      </div>
    </SheetFrame>,
    document.body
  );
}
