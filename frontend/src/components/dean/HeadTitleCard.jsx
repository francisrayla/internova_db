"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";
import { HEAD_TITLES, headTitle } from "@/lib/headTitle";
import { Btn, FormField, Section, Select } from "@/components/dash/page";

/** Lets the school head choose what the app calls them (Dean, Principal or School Head) everywhere in the school. */
export default function HeadTitleCard() {
  const { user, onUserUpdated } = useCurrentUser();
  const current = headTitle(user);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await apiFetch("/api/dean/head-title", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ head_title: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.errors?.head_title?.[0] || data.message || "We couldn't save that. Please try again.");
      onUserUpdated?.({ ...user, head_title: data.head_title, dean_position: data.head_title });
      setMessage(`Saved. You are now shown as ${data.head_title}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Your title" help="How you are named for your coordinator, interns and the Super Admin, for example in greetings, feedback and notifications. Your access does not change.">
      <form onSubmit={save} className="grid max-w-sm gap-3">
        <FormField label="Title">
          <Select value={value} onChange={(e) => { setValue(e.target.value); setMessage(""); }}>
            {HEAD_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
        {message && <p className="k-note" role="status">{message}</p>}
        <div>
          <Btn variant="primary" type="submit" disabled={busy || value === current}>{busy ? "Saving…" : "Save title"}</Btn>
        </div>
      </form>
    </Section>
  );
}
