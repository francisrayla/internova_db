"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import Icon from "@/components/Icon";
import { Avatar, BackLink, ErrorNote, Pill, Skeleton } from "@/components/dean/ui";

const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STATUS = {
  pending: { label: "Invitation pending", tone: "amber" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Deactivated", tone: "slate" },
};

function Card({ title, help, tone = "default", children }) {
  const box = tone === "danger" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white";
  return (
    <section className={`rounded-2xl border p-5 ${box}`}>
      {title && <h2 className={`font-semibold ${tone === "danger" ? "text-red-800" : "text-slate-900"}`}>{title}</h2>}
      {help && <p className={`mt-1 text-sm ${tone === "danger" ? "text-red-700" : "text-slate-500"}`}>{help}</p>}
      <div className={title || help ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/**
 * Full page for the Dean's coordinator actions — invite, resend, correct the
 * email, deactivate — kept apart from the read-only monitoring screen so the
 * risky ones sit behind their own page and a confirmation.
 */
export default function ManageCoordinator() {
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/profile")
      .then((d) => { setProfile(d); setLoadError(false); })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  const coordinator = profile?.coordinator;
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
      load();
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
    <div className="mx-auto max-w-2xl space-y-6 sm:p-2 lg:p-6">
      <div>
        <BackLink href="/dean/coordinator">← Back to coordinator</BackLink>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Manage coordinator</h1>
        <p className="mt-1 text-slate-600">
          Your school has one coordinator, who adds partner companies, supervisors and interns. You can replace them at any time — their records stay safe.
        </p>
      </div>

      {loadError && <ErrorNote onRetry={load}>We couldn&apos;t load your coordinator.</ErrorNote>}
      {profile === undefined && !loadError && <Skeleton className="h-40" />}

      {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {profile !== undefined && coordinator && (
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={coordinator.name} url={coordinator.avatar_url} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold text-slate-900">{coordinator.name}</p>
                <Pill tone={STATUS[coordinator.status]?.tone}>{STATUS[coordinator.status]?.label}</Pill>
              </div>
              <p className="truncate text-sm text-slate-500">{coordinator.email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <dt className="text-xs text-slate-500">Member since</dt>
              <dd className="font-semibold text-slate-900">{formatDate(coordinator.member_since)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <dt className="text-xs text-slate-500">{coordinator.status === "pending" ? "Invitation" : "Last active"}</dt>
              <dd className="font-semibold text-slate-900">
                {coordinator.status === "pending"
                  ? coordinator.invitation_expired ? "Link expired — resend it" : "Waiting for them to set a password"
                  : coordinator.last_active_at ? timeAgo(coordinator.last_active_at) : "Never signed in"}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Pending invitation: resend or correct the address. */}
      {profile !== undefined && coordinator?.status === "pending" && (
        <Card
          title="Invitation"
          help={`${coordinator.email_bounced ? "The last email bounced, so check the address. " : ""}Invitation links last 7 days. Resending sends a fresh link.`}
        >
          {editingEmail ? (
            <form onSubmit={handleChangeEmail} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-slate-700">Corrected email</span>
                <input {...inputProps("email")} type="email" value={newEmail} onChange={(e) => setNewEmail(clean("email", e.target.value))} className={inputClass} />
              </label>
              <p className="text-xs text-slate-500">We&apos;ll send a fresh invitation to the new address.</p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setEditingEmail(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Saving…" : "Save and resend"}</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => run("resend-invitation", "POST")} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                <Icon name="send" size={15} /> {busy ? "Sending…" : "Resend invitation"}
              </button>
              <button type="button" onClick={() => { setNewEmail(coordinator.email); setEditingEmail(true); setError(""); setNotice(""); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Icon name="edit" size={15} /> Change email
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Active coordinator: how replacing works. */}
      {profile !== undefined && coordinator?.status === "active" && (
        <Card title="Replacing your coordinator" help="If someone else will take over, it takes two steps:">
          <ol className="space-y-2 text-sm text-slate-700">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span>Deactivate {coordinator.name.split(" ")[0]} below. They are signed out and can no longer log in.</li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span>Invite the new coordinator on this page. Interns, companies and records stay as they are.</li>
          </ol>
        </Card>
      )}

      {/* No active seat: invite someone. */}
      {profile !== undefined && !hasSeat && (
        <Card
          title={coordinator ? "Invite a replacement" : "Invite your coordinator"}
          help="They get an email with a link to set their own password. The link is valid for 7 days."
        >
          <form onSubmit={handleInvite} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Full name</span>
              <input {...inputProps("fullName")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: clean("fullName", e.target.value) }))} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Email</span>
              <input {...inputProps("email")} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: clean("email", e.target.value) }))} className={inputClass} />
            </label>
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                <Icon name="send" size={15} /> {busy ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Danger zone: only while someone holds the seat. */}
      {profile !== undefined && hasSeat && (
        <Card
          tone="danger"
          title="Danger zone"
          help={coordinator.status === "pending" ? "Cancel this invitation so you can invite someone else." : "Remove this coordinator's access to Internova."}
        >
          {confirmingDeactivate ? (
            <div className="rounded-xl border border-red-200 bg-white p-4 text-sm">
              <p className="font-semibold text-red-800">Deactivate {coordinator.name}?</p>
              <p className="mt-1 text-slate-700">
                They will be signed out right away and can no longer log in. Everything they did stays on record, and you can invite a replacement afterwards.
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setConfirmingDeactivate(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Keep coordinator</button>
                <button type="button" disabled={busy} onClick={() => run("deactivate", "POST", null, () => setConfirmingDeactivate(false))} className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {busy ? "Deactivating…" : "Yes, deactivate"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setConfirmingDeactivate(true); setError(""); setNotice(""); }} className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
              Deactivate coordinator
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
