"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";

const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function ManageTab({ coordinator, onChanged }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const hasSeat = coordinator && coordinator.status !== "inactive";

  // Runs one coordinator action and reports the server's own message.
  async function run(path, method, body, onDone) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/api/dean/coordinator/${path}`, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || data.errors?.email?.[0] || "Something went wrong.");
      setNotice(data.message);
      onDone?.();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleInvite(e) {
    e.preventDefault();
    if (!form.name.trim() || !EMAIL_PATTERN.test(form.email)) {
      setError("Enter the coordinator's full name and a valid email address.");
      return;
    }
    run("invite", "POST", form, () => setForm({ name: "", email: "" }));
  }

  function handleChangeEmail(e) {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(newEmail) || newEmail === coordinator.email) {
      setError("Enter a different, valid email address.");
      return;
    }
    run("email", "PATCH", { email: newEmail }, () => setEditingEmail(false));
  }

  return (
    <div className="max-w-xl space-y-5">
      <p className="text-sm text-slate-500">
        Each school has one coordinator, who adds your partner companies, supervisors and interns. You can replace them at any time. Their records stay safe.
      </p>

      {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {hasSeat && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <p className="font-semibold text-slate-900">{coordinator.name}</p>
          <p className="text-slate-500">{coordinator.email}</p>

          {coordinator.status === "pending" && (
            <p className="mt-3 text-xs text-slate-500">
              {coordinator.invitation_expired ? "The invitation link has expired, so please resend it. " : "They have not set their password yet. "}
              {coordinator.email_bounced && "The last email bounced; check the address and change it below. "}
              Invitation links last 7 days.
            </p>
          )}

          {editingEmail ? (
            <form onSubmit={handleChangeEmail} className="mt-4 space-y-3">
              <input {...inputProps("email")} type="email" value={newEmail} onChange={(e) => setNewEmail(clean("email", e.target.value))} className={inputClass} placeholder="Corrected email address" />
              <p className="text-xs text-slate-500">We&apos;ll send a fresh invitation to the new address.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingEmail(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Saving…" : "Save and resend"}</button>
              </div>
            </form>
          ) : confirmingDeactivate ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="font-semibold text-red-800">Deactivate {coordinator.name}?</p>
              <p className="mt-1 text-red-800">
                They will be signed out right away and can no longer log in. Everything they did stays on record, and you can invite a replacement afterwards.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmingDeactivate(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Keep coordinator</button>
                <button type="button" disabled={busy} onClick={() => run("deactivate", "POST", null, () => setConfirmingDeactivate(false))} className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {busy ? "Deactivating…" : "Yes, deactivate"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {coordinator.status === "pending" && (
                <>
                  <button type="button" disabled={busy} onClick={() => run("resend-invitation", "POST")} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    Resend invitation
                  </button>
                  <button type="button" onClick={() => { setNewEmail(coordinator.email); setEditingEmail(true); setError(""); setNotice(""); }} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">
                    Change email
                  </button>
                </>
              )}
              <button type="button" onClick={() => { setConfirmingDeactivate(true); setError(""); setNotice(""); }} className="rounded-xl border border-red-300 px-4 py-2 font-medium text-red-700 hover:bg-red-50">
                Deactivate
              </button>
            </div>
          )}
        </div>
      )}

      {!hasSeat && (
        <form onSubmit={handleInvite} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="font-semibold text-slate-900">{coordinator ? "Invite a replacement" : "Invite your coordinator"}</h2>
            <p className="mt-1 text-sm text-slate-500">They get an email with a link to set their own password. The link is valid for 7 days.</p>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Full name</span>
            <input {...inputProps("fullName")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: clean("fullName", e.target.value) }))} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
            <input {...inputProps("email")} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: clean("email", e.target.value) }))} className={inputClass} />
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Sending…" : "Send invitation"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
