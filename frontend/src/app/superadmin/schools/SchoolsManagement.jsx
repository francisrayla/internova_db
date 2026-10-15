"use client";

import { useEffect, useRef, useState } from "react";
import FileLink from "@/components/FileViewer";
import { useSearchParams } from "next/navigation";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";
import BillingBreakdown from "@/components/BillingBreakdown";
import { Check, Pause, Play, RotateCw } from "lucide-react";
import { Btn, EmptyState, FilterBar, FormField, Input, KeyValueList, Page, PageHeader, Pill, SearchField, Section, Select, SheetFrame, SkeletonList, TableWrap } from "@/components/dash/page";
import NavIcon from "@/components/NavIcon";
import SaToast, { useSaToast } from "../SaToast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { inputProps } from "@/lib/inputRules";
import { HEAD_TITLES, headTitleOf } from "@/lib/headTitle";
const FILTERS = ["All Schools", "Awaiting Acceptance", "Accepted", "Pending Payment", "Active", "Offer Expired", "Paused", "Past Due", "Expired"];

function filterToStatus(filter) {
  return filter.toLowerCase().replace(/\s+/g, "_");
}

// "Paused" isn't a lifecycle status — it's the independent is_suspended flag —
// so it needs its own match instead of a plain status string comparison.
function matchesFilter(school, filter) {
  if (filter === "All Schools") return true;
  if (filter === "Paused") return school.is_suspended;
  return school.status === filterToStatus(filter);
}

// Lifecycle status -> chip tone and wording (the soft chips shared by every screen).
const STATUS_TONE = {
  pending_setup: "slate",
  awaiting_acceptance: "blue",
  accepted: "blue",
  pending_payment: "amber",
  active: "green",
  offer_expired: "red",
  past_due: "amber",
  expired: "slate",
};

const STATUS_LABEL = {
  pending_setup: "Pending Setup",
  awaiting_acceptance: "Awaiting Acceptance",
  accepted: "Accepted",
  pending_payment: "Pending Payment",
  active: "Active",
  offer_expired: "Offer Expired",
  past_due: "Past Due",
  expired: "Expired",
};

function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status] ?? "slate"}>{STATUS_LABEL[status] ?? status}</Pill>;
}

function PausedPill() {
  return (
    <Pill tone="red">
      <Pause size={12} aria-hidden="true" className="mr-1 inline-block align-[-1px]" />
      Paused
    </Pill>
  );
}

function SetupPill({ ok, okLabel, badLabel }) {
  return <Pill tone={ok ? "green" : "amber"}>{ok ? okLabel : badLabel}</Pill>;
}

// The school head (Dean, Principal or School Head, as picked at registration) owns billing. A legacy school (registered before the Dean role) has
// none yet: invite one here, or resend / correct the invitation while pending.
function DeanInvite({ school, onDone }) {
  const [form, setForm] = useState({ name: "", email: "", position: HEAD_TITLES[0] });
  const [email, setEmail] = useState(school.dean_email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(path, body) {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/superadmin/schools/${school.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || data.errors?.email?.[0] || data.errors?.name?.[0] || "Something went wrong.");
      onDone(data.message);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!school.dean_email) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); send("invite-dean", form); }}
        className="grid gap-3 rounded-[14px] border p-4"
        style={{ borderColor: "var(--ui-line)", background: "var(--ui-soft)" }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--ui-ink)" }}>No school head yet</p>
          <p className="k-hint mt-1">The school head accepts the plan, pays and invites the coordinator. They get an email link to set their own password.</p>
        </div>
        <FormField label="Title">
          <Select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}>
            {HEAD_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        <FormField label="Full name">
          <Input {...inputProps("fullName")} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name of the school head" />
        </FormField>
        <FormField label="Email">
          <Input {...inputProps("email")} required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.trim() }))} placeholder="Email of the school head" />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
        <Btn variant="primary" block type="submit" disabled={busy}>
          {busy ? "Sending…" : `Invite ${form.position}`}
        </Btn>
      </form>
    );
  }

  if (school.dean_setup === "pending") {
    return (
      <div className="grid gap-3 rounded-[14px] border p-4" style={{ borderColor: "var(--ui-line)", background: "var(--ui-soft)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--ui-ink)" }}>Waiting for the {headTitleOf(school.dean_title)} ({school.dean_email}) to accept the invitation and set a password.</p>
        <FormField label={`${headTitleOf(school.dean_title)}'s email`}>
          <Input {...inputProps("email")} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
        <Btn
          variant="primary"
          block
          disabled={busy}
          onClick={() => send("resend-dean-invitation", email !== school.dean_email ? { email } : {})}
        >
          {busy ? "Sending…" : email !== school.dean_email ? "Change Email & Resend" : (<><RotateCw size={15} aria-hidden="true" /> Resend Invitation</>)}
        </Btn>
      </div>
    );
  }

  return null;
}

export default function SchoolsPage() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [schools, setSchools] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All Schools");
  const [loading, setLoading] = useState(true);
  const [manageSchool, setManageSchool] = useState(null);
  const [toast, showToast] = useSaToast();
  const [confirming, setConfirming] = useState(false);
  const [payConfirm, setPayConfirm] = useState(null); // { school, amount } waiting for "yes, mark as paid"
  const [confirmingPauseId, setConfirmingPauseId] = useState(null); // holds the school id being confirmed, never a stale boolean
  const hasAutoOpenedHighlight = useRef(false);
  const echoChannelRef = useRef(null);

  function load() {
    setLoading(true);
    fetchSuperadminData("schools")
      .then((r) => {
        const data = r.schools ?? [];
        setSchools(data);
        // Only auto-open from the ?highlight= link once — otherwise every live
        // refresh would keep re-popping the modal back open after it's closed.
        if (highlightId && !hasAutoOpenedHighlight.current) {
          const match = data.find((s) => String(s.id) === String(highlightId));
          if (match) setManageSchool(match);
          hasAutoOpenedHighlight.current = true;
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: refetch whenever any billing/school event broadcasts —
  // same channel the notification bell listens to (see App\Events\NotificationCreated).
  useEffect(() => {
    const echo = getEcho();
    if (!echo) return;

    function handlePush() {
      load();
    }

    // NotificationBell and the Billing/Plans screens share this same public
    // channel — echo.leave() would tear it down for all of them, so this
    // only unbinds this component's own listener on cleanup.
    echoChannelRef.current = echo.private("superadmin.notifications").listen(".notification.created", handlePush);

    return () => {
      echo.private("superadmin.notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = schools.filter((s) => {
    const matchQuery = s.name.toLowerCase().includes(query.toLowerCase());
    return matchesFilter(s, filter) && matchQuery;
  });

  function handleConfirmPayment(school) {
    setConfirming(true);
    apiFetch(`/api/superadmin/schools/${school.id}/confirm-payment`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to confirm payment.");
        return data;
      })
      .then((data) => {
        showToast(data.message || "Payment confirmed.");
        setManageSchool(null);
        load();
      })
      .catch((err) => showToast(err.message))
      .finally(() => setConfirming(false));
  }

  function handleVerifyPayment(school) {
    setConfirming(true);
    apiFetch(`/api/superadmin/schools/${school.id}/verify-payment`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to verify payment.");
        return data;
      })
      .then((data) => {
        showToast(data.message || "Payment verified.");
        setManageSchool(null);
        load();
      })
      .catch((err) => showToast(err.message))
      .finally(() => setConfirming(false));
  }

  function handleResendOffer(school) {
    setConfirming(true);
    apiFetch(`/api/superadmin/schools/${school.id}/resend-offer`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to resend offer.");
        return data;
      })
      .then((data) => {
        showToast(data.message || "New offer sent.");
        setManageSchool(null);
        load();
      })
      .catch((err) => showToast(err.message))
      .finally(() => setConfirming(false));
  }

  function handleToggleSuspend(school) {
    setConfirmingPauseId(null);
    apiFetch(`/api/superadmin/schools/${school.id}/toggle-suspend`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to update school access.");
        return data;
      })
      .then((data) => {
        showToast(data.message || "Updated.");
        setManageSchool(null);
        load();
      })
      .catch((err) => showToast(err.message));
  }

  return (
    <Page size="wide">
      <SaToast msg={toast} />

      <PageHeader
        title="Schools"
        sentence="Schools are created from approved Plan Inquiries. A school becomes fully active once its school head accepts the subscription offer and payment is confirmed."
      >
        <Btn variant="primary" href="/superadmin/inquiries">
          Plan Inquiries <NavIcon name="arrow" size={16} />
        </Btn>
      </PageHeader>

      <FilterBar>
        <SearchField {...inputProps("search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search school name" aria-label="Search school name" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status" className="sm:w-auto">
          {FILTERS.map((f) => <option key={f}>{f}</option>)}
        </Select>
      </FilterBar>

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : filtered.length === 0 ? (
          <div className="k-pad">
            <EmptyState
              icon="schools"
              title="No schools found"
              text={schools.length === 0 ? "Schools show up here once you approve a Plan Inquiry." : "Try a different name or pick All Schools."}
              action={schools.length === 0 ? <Btn href="/superadmin/inquiries">Open Plan Inquiries</Btn> : undefined}
            />
          </div>
        ) : (
          <TableWrap>
            <table className="k-table is-hover is-stack">
              <thead>
                <tr>
                  {["School", "Plan", "Head", "Payment", "Subscription", "Action"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((school) => (
                  <tr key={school.id} className={String(school.id) === String(highlightId) ? "bg-blue-50" : ""}>
                    <td className="is-title">
                      <span className="block font-medium">{school.name}</span>
                      <span className="block text-xs font-normal" style={{ color: "var(--ui-muted)" }}>
                        {school.admin_email ? `Coordinator: ${school.admin_name}` : "No coordinator yet"}
                      </span>
                    </td>
                    <td data-label="Plan">
                      <span className="block">
                        {school.plan}
                        {school.amount != null && (
                          <span className="block text-xs" style={{ color: "var(--ui-muted)" }}>
                            ₱{Number(school.amount).toLocaleString()} / {school.billing_period === "monthly" ? "mo" : "yr"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Head">
                      {school.dean_email ? (
                        <span className="block min-w-0 max-sm:text-right">
                          <span className="block text-sm font-medium">{school.dean_name}</span>
                          <span className="block text-xs font-medium" style={{ color: "var(--ui-muted)" }}>{headTitleOf(school.dean_title)}</span>
                          <span className="mb-1 block break-all text-xs" style={{ color: "var(--ui-muted)" }}>{school.dean_email}</span>
                          <SetupPill ok={school.dean_setup === "active"} okLabel="Active" badLabel="Invitation Pending" />
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--ui-muted)" }}>No head yet</span>
                      )}
                    </td>
                    <td data-label="Payment">
                      <SetupPill ok={school.payment === "paid"} okLabel="Paid" badLabel="Unpaid" />
                    </td>
                    <td data-label="Subscription">
                      <span className="flex flex-wrap items-center gap-1.5 max-sm:justify-end">
                        <StatusPill status={school.status} />
                        {school.is_suspended && <PausedPill />}
                      </span>
                    </td>
                    <td className="is-actions">
                      <Btn
                        sm
                        aria-label={`Manage ${school.name}`}
                        onClick={() => {
                          // Clicking Manage on the row that's already open closes it —
                          // the button doubles as its own close control, not just an opener.
                          if (manageSchool?.id === school.id) {
                            setManageSchool(null);
                          } else {
                            setManageSchool(school);
                          }
                          setConfirmingPauseId(null);
                        }}
                      >
                        Manage
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {/* Manage School Modal */}
      {manageSchool && (
        <SheetFrame
          title={manageSchool.name}
          description={manageSchool.dean_name ? `${headTitleOf(manageSchool.dean_title)}: ${manageSchool.dean_name}` : "No school head yet"}
          size="md"
          onClose={() => { setManageSchool(null); setConfirmingPauseId(null); }}
        >
          <div className="grid gap-4">
            <KeyValueList
              items={[
                {
                  label: "Status",
                  value: (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusPill status={manageSchool.status} />
                      {manageSchool.is_suspended && <PausedPill />}
                    </span>
                  ),
                },
                { label: "Plan", value: manageSchool.plan },
                ...(manageSchool.amount != null
                  ? [{ label: "Amount", value: `₱${Number(manageSchool.amount).toLocaleString()} / ${manageSchool.billing_period === "monthly" ? "mo" : "yr"}` }]
                  : []),
              ]}
            />
            {manageSchool.scheduled_switch && (
              <p className="k-note">
                <span className="min-w-0">
                  Scheduled switch: <strong>{manageSchool.scheduled_switch.plan} ({manageSchool.scheduled_switch.billing_period})</strong> starts {manageSchool.scheduled_switch.starts_on}, billed ₱{Number(manageSchool.scheduled_switch.amount ?? 0).toLocaleString()} then.
                </span>
              </p>
            )}
            <BillingBreakdown breakdown={manageSchool.breakdown} title="Subscription price breakdown" />
            <KeyValueList
              items={[
                { label: manageSchool.dean_name ? headTitleOf(manageSchool.dean_title) : "School head", value: manageSchool.dean_name ?? "None yet" },
                ...(manageSchool.dean_email
                  ? [{ label: `${headTitleOf(manageSchool.dean_title)} Setup`, value: <SetupPill ok={manageSchool.dean_setup === "active"} okLabel="Active" badLabel="Invitation Pending" /> }]
                  : []),
                { label: "Coordinator", value: manageSchool.admin_name || "None yet" },
                { label: "Payment", value: <SetupPill ok={manageSchool.payment === "paid"} okLabel="Paid" badLabel="Unpaid" /> },
                { label: "Expiry", value: manageSchool.expiry },
              ]}
            />

            {manageSchool.is_suspended ? (
              // Paused overrides whatever lifecycle stage the school is in below it —
              // that stage is preserved (see the Status row above) and picks back up
              // automatically once access is restored.
              <>
                <p className="k-note is-risk">
                  <span className="min-w-0">Access is paused — the school&apos;s coordinator sees a read-only notice and can&apos;t use the dashboard until you restore access. Nothing was deleted.</span>
                </p>
                <Btn variant="primary" block onClick={() => handleToggleSuspend(manageSchool)}>
                  <Play size={15} aria-hidden="true" /> Restore School Access
                </Btn>
              </>
            ) : (
              <>
                <DeanInvite
                  key={manageSchool.id}
                  school={manageSchool}
                  onDone={(message) => { showToast(message); setManageSchool(null); load(); }}
                />

                {manageSchool.status === "awaiting_acceptance" && (
                  <p className="k-note">
                    <span className="min-w-0">
                      Subscription offer sent to {manageSchool.dean_email ?? manageSchool.admin_email}. Waiting for the {headTitleOf(manageSchool.dean_title)} to review and accept it.
                      {manageSchool.offer_expires_at && <> Expires {manageSchool.offer_expires_at} if unanswered.</>}
                    </span>
                  </p>
                )}

                {manageSchool.status === "offer_expired" && (
                  <div className="grid gap-3">
                    <p className="k-note is-risk">
                      <span className="min-w-0">This offer expired before {manageSchool.dean_email ?? manageSchool.admin_email} accepted or paid.</span>
                    </p>
                    <Btn variant="primary" block onClick={() => handleResendOffer(manageSchool)} disabled={confirming}>
                      {confirming ? "Sending…" : (<><RotateCw size={15} aria-hidden="true" /> Send New Offer</>)}
                    </Btn>
                  </div>
                )}

                {manageSchool.status === "accepted" && (
                  <p className="k-note">
                    <span className="min-w-0">{manageSchool.dean_email ?? manageSchool.admin_email} accepted the offer and is choosing a payment method.</span>
                  </p>
                )}

                {manageSchool.status === "pending_payment" && manageSchool.payment_status === "pending_verification" && (
                  <div className="grid gap-3">
                    <p className="k-note is-warn">
                      <span className="min-w-0 font-semibold">Bank transfer proof submitted — review before verifying.</span>
                    </p>
                    {manageSchool.proof_of_payment_url && (
                      <FileLink url={manageSchool.proof_of_payment_url} name="Proof of payment" className="dash-link inline-flex min-h-[44px] items-center gap-1 sm:min-h-0">
                        View Uploaded Proof <NavIcon name="arrow" size={14} />
                      </FileLink>
                    )}
                    <Btn variant="primary" block onClick={() => handleVerifyPayment(manageSchool)} disabled={confirming}>
                      {confirming ? "Verifying…" : (<><Check size={15} aria-hidden="true" /> Verify & Activate Subscription</>)}
                    </Btn>
                  </div>
                )}

                {manageSchool.status === "pending_payment" && manageSchool.payment_status !== "pending_verification" && manageSchool.payment !== "paid" && (
                  <Btn variant="primary" block onClick={() => setPayConfirm({ school: manageSchool, amount: manageSchool.amount })} disabled={confirming}>
                    {confirming ? "Confirming…" : (<><Check size={15} aria-hidden="true" /> Confirm Payment Received (manual override)</>)}
                  </Btn>
                )}

                {manageSchool.awaiting_payment_change && (
                  <div className="grid gap-3">
                    <p className="k-note is-warn">
                      <span className="min-w-0 font-semibold">
                        Approved — awaiting payment: {manageSchool.awaiting_payment_change.plan} ({manageSchool.awaiting_payment_change.billing_period}),
                        ₱{Number(manageSchool.awaiting_payment_change.amount ?? 0).toLocaleString()}. The current plan stays active until it is paid.
                      </span>
                    </p>
                    <BillingBreakdown breakdown={manageSchool.awaiting_payment_change.breakdown} title="Approved change" />
                    {manageSchool.awaiting_payment_change.proof_of_payment_url && (
                      <FileLink url={manageSchool.awaiting_payment_change.proof_of_payment_url} name="Proof of payment" className="dash-link inline-flex min-h-[44px] items-center gap-1 sm:min-h-0">
                        View Uploaded Proof <NavIcon name="arrow" size={14} />
                      </FileLink>
                    )}
                    {manageSchool.awaiting_payment_change.payment_status === "pending_verification" ? (
                      <Btn variant="primary" block onClick={() => handleVerifyPayment(manageSchool)} disabled={confirming}>
                        {confirming ? "Verifying…" : (<><Check size={15} aria-hidden="true" /> Verify & Activate Change</>)}
                      </Btn>
                    ) : (
                      <Btn block onClick={() => setPayConfirm({ school: manageSchool, amount: manageSchool.awaiting_payment_change.amount })} disabled={confirming}>
                        {confirming ? "Working…" : manageSchool.awaiting_payment_change.waived ? "Activate without payment (₱0, waived)" : (<><Check size={15} aria-hidden="true" /> Confirm Payment Received (manual override)</>)}
                      </Btn>
                    )}
                  </div>
                )}

                {manageSchool.status === "active" && (
                  <p className="k-note is-ok">
                    <span className="min-w-0">This school is fully active. Premium/Basic features are enabled per their plan.</span>
                  </p>
                )}

                {manageSchool.status === "active" && confirmingPauseId !== manageSchool.id && (
                  <Btn variant="danger-quiet" block onClick={() => setConfirmingPauseId(manageSchool.id)}>
                    <Pause size={15} aria-hidden="true" /> Pause School Access
                  </Btn>
                )}

                {manageSchool.status === "active" && confirmingPauseId === manageSchool.id && (
                  <div className="grid gap-3">
                    <p className="k-note is-risk">
                      <span className="min-w-0">
                        Pause access for <strong>{manageSchool.name}</strong>? Their coordinator won&apos;t be able to use the dashboard until you restore it — you can undo this any time.
                      </span>
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row-reverse">
                      <Btn variant="danger" className="sm:flex-1" onClick={() => handleToggleSuspend(manageSchool)}>
                        Yes, Pause Access
                      </Btn>
                      <Btn className="sm:flex-1" onClick={() => setConfirmingPauseId(null)}>
                        Cancel
                      </Btn>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetFrame>
      )}

      <ConfirmDialog
        open={!!payConfirm}
        tone="primary"
        title="Mark this payment as received?"
        confirmLabel="Yes, payment received"
        busy={confirming}
        onConfirm={() => { const school = payConfirm.school; setPayConfirm(null); handleConfirmPayment(school); }}
        onCancel={() => setPayConfirm(null)}
      >
        <p>
          {payConfirm?.school.name} will be activated as a paid subscription
          {payConfirm?.amount != null ? <> for <strong>₱{Number(payConfirm.amount).toLocaleString()}</strong></> : null}, without checking a payment record.
          Use this only when you have seen the money arrive.
        </p>
      </ConfirmDialog>
    </Page>
  );
}
