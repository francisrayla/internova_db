"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { clean, inputProps } from "@/lib/inputRules";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import Icon from "@/components/Icon";
import { Avatar, Banner, ErrorNote, Pill, Skeleton } from "@/components/dean/ui";
import { Btn, FormField, Input, KeyValueList, Page, PageHeader, Section } from "@/components/dash/page";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STATUS = {
  pending: { label: "Invitation pending", tone: "amber" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Deactivated", tone: "slate" },
};

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
    <Page size="narrow">
      <PageHeader
        back={{ href: "/dean/coordinator", label: "Back to coordinator" }}
        title="Manage coordinator"
        sentence="Your school has one coordinator, who adds partner companies, supervisors and interns. You can replace them at any time — their records stay safe."
      />

      {loadError && <ErrorNote onRetry={load}>We couldn&apos;t load your coordinator.</ErrorNote>}
      {profile === undefined && !loadError && <Skeleton className="h-40" />}

      {notice && <Banner tone="green">{notice}</Banner>}
      {error && <Banner tone="red">{error}</Banner>}

      {profile !== undefined && coordinator && (
        <Section>
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={coordinator.name} url={coordinator.avatar_url} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 truncate text-base font-semibold text-slate-900">{coordinator.name}</p>
                <Pill tone={STATUS[coordinator.status]?.tone}>{STATUS[coordinator.status]?.label}</Pill>
              </div>
              <p className="truncate text-sm text-slate-600">{coordinator.email}</p>
            </div>
          </div>
          <KeyValueList
            className="mt-4"
            items={[
              { label: "Member since", value: formatDate(coordinator.member_since) },
              {
                label: coordinator.status === "pending" ? "Invitation" : "Last active",
                value: coordinator.status === "pending"
                  ? coordinator.invitation_expired ? "Link expired — resend it" : "Waiting for them to set a password"
                  : coordinator.last_active_at ? timeAgo(coordinator.last_active_at) : "Never signed in",
              },
            ]}
          />
        </Section>
      )}

      {/* Pending invitation: resend or correct the address. */}
      {profile !== undefined && coordinator?.status === "pending" && (
        <Section
          title="Invitation"
          help={`${coordinator.email_bounced ? "The last email bounced, so check the address. " : ""}Invitation links last 7 days. Resending sends a fresh link.`}
        >
          {editingEmail ? (
            <form onSubmit={handleChangeEmail} className="space-y-4">
              <FormField label="Corrected email" hint="We'll send a fresh invitation to the new address.">
                <Input {...inputProps("email")} type="email" value={newEmail} onChange={(e) => setNewEmail(clean("email", e.target.value))} />
              </FormField>
              <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
                <Btn onClick={() => setEditingEmail(false)}>Cancel</Btn>
                <Btn type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save and resend"}</Btn>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2 max-sm:flex-col">
              <Btn variant="primary" disabled={busy} onClick={() => run("resend-invitation", "POST")}>
                <Icon name="send" size={15} /> {busy ? "Sending…" : "Resend invitation"}
              </Btn>
              <Btn onClick={() => { setNewEmail(coordinator.email); setEditingEmail(true); setError(""); setNotice(""); }}>
                <Icon name="edit" size={15} /> Change email
              </Btn>
            </div>
          )}
        </Section>
      )}

      {/* Active coordinator: how replacing works. */}
      {profile !== undefined && coordinator?.status === "active" && (
        <Section title="Replacing your coordinator" help="If someone else will take over, it takes two steps:">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 marker:text-slate-500">
            <li className="pl-1">Deactivate {coordinator.name.split(" ")[0]} below. They are signed out and can no longer log in.</li>
            <li className="pl-1">Invite the new coordinator on this page. Interns, companies and records stay as they are.</li>
          </ol>
        </Section>
      )}

      {/* No active seat: invite someone. */}
      {profile !== undefined && !hasSeat && (
        <Section
          title={coordinator ? "Invite a replacement" : "Invite your coordinator"}
          help="They get an email with a link to set their own password. The link is valid for 7 days."
        >
          <form onSubmit={handleInvite} className="space-y-4">
            <FormField label="Full name">
              <Input {...inputProps("fullName")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: clean("fullName", e.target.value) }))} />
            </FormField>
            <FormField label="Email">
              <Input {...inputProps("email")} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: clean("email", e.target.value) }))} />
            </FormField>
            <div className="flex justify-end">
              <Btn type="submit" variant="primary" disabled={busy} className="max-sm:w-full">
                <Icon name="send" size={15} /> {busy ? "Sending…" : "Send invitation"}
              </Btn>
            </div>
          </form>
        </Section>
      )}

      {/* Danger zone: only while someone holds the seat. */}
      {profile !== undefined && hasSeat && (
        <Section
          title="Danger zone"
          help={coordinator.status === "pending" ? "Cancel this invitation so you can invite someone else." : "Remove this coordinator's access to Internova."}
        >
          {confirmingDeactivate ? (
            <div className="space-y-3" role="group" aria-label={`Deactivate ${coordinator.name}?`}>
              <div className="k-note is-risk block">
                <p className="font-semibold">Deactivate {coordinator.name}?</p>
                <p className="mt-1">
                  They will be signed out right away and can no longer log in. Everything they did stays on record, and you can invite a replacement afterwards.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
                <Btn onClick={() => setConfirmingDeactivate(false)}>Keep coordinator</Btn>
                <Btn variant="danger" disabled={busy} onClick={() => run("deactivate", "POST", null, () => setConfirmingDeactivate(false))}>
                  {busy ? "Deactivating…" : "Yes, deactivate"}
                </Btn>
              </div>
            </div>
          ) : (
            <Btn variant="danger-quiet" onClick={() => { setConfirmingDeactivate(true); setError(""); setNotice(""); }} className="max-sm:w-full">
              Deactivate coordinator
            </Btn>
          )}
        </Section>
      )}
    </Page>
  );
}
