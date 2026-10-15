"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";
import { clampOnBlur } from "@/lib/clampNumber";
import { Pause } from "lucide-react";
import { Btn, DataList, DataRow, EmptyState, ErrorNote, FormField, Input, Page, PageHeader, Pill, Section, SheetFrame, SkeletonList, TableWrap, Textarea } from "@/components/dash/page";
import NavIcon from "@/components/NavIcon";
import SaToast, { useSaToast } from "../SaToast";

import { inputProps, cleanNumber } from "@/lib/inputRules";

const REQUEST_STATUS_TONE = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

function PlanChangeRequests({ showToast, reloadKey }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null); // request row being approved
  const [discount, setDiscount] = useState("");
  const [agreementNote, setAgreementNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetchSuperadminData("plan-change-requests")
      .then((r) => setRequests(r.requests ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, [reloadKey]);

  function openApprove(req) {
    setReviewing(req);
    setDiscount("");
    setAgreementNote("");
  }

  function handleApprove(e) {
    e.preventDefault();
    setBusy(true);
    apiFetch(`/api/superadmin/plan-change-requests/${reviewing.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discount_amount: discount ? Number(discount) : 0,
        agreement_note: agreementNote || null,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not approve this request.");
        return data;
      })
      .then((data) => {
        showToast(data.message);
        setReviewing(null);
        load();
      })
      .catch((err) => showToast(err.message))
      .finally(() => setBusy(false));
  }

  function handleReject(req) {
    setBusy(true);
    apiFetch(`/api/superadmin/plan-change-requests/${req.id}/reject`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not decline this request.");
        return data;
      })
      .then((data) => {
        showToast(data.message);
        load();
      })
      .catch((err) => showToast(err.message))
      .finally(() => setBusy(false));
  }

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  return (
    <Section
      title="Plan Change Requests"
      help="Schools asking to switch plan or billing period. Approve to set the final price."
      flush
      action={pending.length > 0 ? <Pill tone="amber">{pending.length} pending</Pill> : undefined}
    >
      {loading ? (
        <div className="k-pad"><SkeletonList rows={2} height="h-16" /></div>
      ) : requests.length === 0 ? (
        <div className="k-pad">
          <EmptyState icon="plans" title="No plan change requests yet." text="When a school head asks to switch plans, the request shows up here." />
        </div>
      ) : (
        <DataList>
          {[...pending, ...reviewed.slice(0, 5)].map((req) => (
            <DataRow
              key={req.id}
              wrap
              title={req.school_name}
              sub={
                <>
                  <span className="block">
                    {req.current_plan ?? "—"} ({req.current_billing_period ?? "—"}) → <strong style={{ color: "var(--ui-ink)" }}>{req.requested_plan}</strong> ({req.requested_billing_period}) · list price ₱{Number(req.list_price ?? 0).toLocaleString()}
                  </span>
                  {req.note && (
                    <span className="mt-1.5 block rounded-lg px-3 py-2" style={{ background: "var(--ui-soft)" }}>&ldquo;{req.note}&rdquo;</span>
                  )}
                  <span className="mt-1 block text-xs">{req.submitted_at}</span>
                </>
              }
              side={
                <Pill tone={req.awaiting_payment ? "amber" : REQUEST_STATUS_TONE[req.status] ?? "slate"} className="capitalize">
                  {req.awaiting_payment ? "Approved — awaiting payment" : req.status}
                </Pill>
              }
              actions={
                req.status === "pending" ? (
                  <>
                    <Btn variant="primary" sm onClick={() => openApprove(req)} disabled={busy}>Approve</Btn>
                    <Btn sm onClick={() => handleReject(req)} disabled={busy}>Decline</Btn>
                  </>
                ) : undefined
              }
            />
          ))}
        </DataList>
      )}

      {reviewing && (
        <SheetFrame
          title={`Approve — ${reviewing.school_name}`}
          onClose={() => setReviewing(null)}
          onSubmit={handleApprove}
          footer={
            <>
              <Btn onClick={() => setReviewing(null)}>Cancel</Btn>
              <Btn variant="primary" type="submit" disabled={busy}>{busy ? "Applying…" : "Approve & Apply"}</Btn>
            </>
          }
        >
          <div className="grid gap-4">
            <p className="text-sm" style={{ color: "var(--ui-muted)" }}>
              Switching to <strong style={{ color: "var(--ui-ink)" }}>{reviewing.requested_plan}</strong> ({reviewing.requested_billing_period}) — list price ₱{Number(reviewing.list_price ?? 0).toLocaleString()}.
            </p>
            <FormField label="Discount Amount (optional)">
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={discount}
                onChange={(e) => setDiscount(cleanNumber(e.target.value, { max: Number(reviewing.list_price ?? 0), decimals: 2 }))}
                onBlur={(e) => setDiscount(clampOnBlur(e.target.value, 0, Number(reviewing.list_price ?? 0)))}
                placeholder="0"
              />
            </FormField>
            <FormField
              label={<>Agreement Note {Number(discount || 0) > 0 && <span className="k-req" aria-hidden="true">*</span>}</>}
            >
              <Textarea
                {...inputProps("note")}
                rows={2}
                required={Number(discount || 0) > 0}
                value={agreementNote}
                onChange={(e) => setAgreementNote(e.target.value)}
                placeholder="Reason for the discount / special terms"
              />
            </FormField>
            <p className="k-note">
              <span className="font-semibold">Final amount: ₱{Math.max(0, Number(reviewing.list_price ?? 0) - Number(discount || 0)).toLocaleString()}</span>
            </p>
          </div>
        </SheetFrame>
      )}
    </Section>
  );
}

const SUBSCRIPTION_TONE = {
  active: "green",
  expired: "red",
  offer_expired: "red",
  pending_payment: "amber",
  awaiting_acceptance: "blue",
  accepted: "blue",
};

export default function BillingPage() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, showToast] = useSaToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const [revenue, setRevenue] = useState(null); // server figures (same source as the Dashboard "Recurring each month")
  const [loadError, setLoadError] = useState("");
  const echoChannelRef = useRef(null);

  function load() {
    fetchSuperadminData("schools")
      .then((r) => {
        setSchools(r.schools ?? []);
        setLoadError("");
      })
      .catch((e) => setLoadError(e.message || "Could not load the schools."))
      .finally(() => setLoading(false));
    fetchSuperadminData("revenue")
      .then((r) => setRevenue(r))
      .catch(() => setRevenue(null));
  }

  useEffect(() => {
    load();
  }, [reloadKey]);

  // Live updates: any billing-relevant event (payment confirmed/verified, plan
  // change approved, proof uploaded...) broadcasts on this same channel the bell
  // already listens to — reacting to it here just means "something changed,
  // refetch," not duplicating the notification's own data.
  useEffect(() => {
    const echo = getEcho();
    if (!echo) return;

    function handlePush() {
      setLastLiveUpdate(new Date());
      setReloadKey((k) => k + 1);
    }

    // NotificationBell and the Schools/Plans screens share this same public
    // channel — echo.leave() would tear it down for all of them, so this
    // only unbinds this component's own listener on cleanup.
    echoChannelRef.current = echo.private("superadmin.notifications").listen(".notification.created", handlePush);

    return () => {
      echo.private("superadmin.notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
  }, []);

  const activeSchools = schools.filter((s) => s.subscription_status === "active");
  // The server's figure when we have it, so this page and the Dashboard never disagree; the browser sum is only a fallback.
  const localMonthly = activeSchools.reduce((sum, s) => {
    const amount = Number(s.amount ?? 0);
    return sum + (s.billing_period === "yearly" ? amount / 12 : amount);
  }, 0);
  const monthlyRevenue = revenue?.recurring_monthly != null ? Number(revenue.recurring_monthly) : localMonthly;
  const activeCount = revenue?.active_subscriptions != null ? revenue.active_subscriptions : activeSchools.length;
  const pendingCount = schools.filter((s) => s.subscription_status === "pending_payment").length;
  const pausedCount = schools.filter((s) => s.is_suspended).length;

  const figures = [
    { label: "Active Subscriptions", value: activeCount },
    { label: "Est. Monthly Revenue", value: `₱${monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
    { label: "Pending Payment", value: pendingCount },
    { label: "Paused", value: pausedCount },
  ];

  return (
    <Page size="wide">
      <SaToast msg={toast} />

      <PageHeader
        title="Billing"
        sentence="Where every school stands on its subscription, and the plan changes waiting for your decision."
        meta={lastLiveUpdate ? `Live: updated ${lastLiveUpdate.toLocaleTimeString()}` : undefined}
      />

      {loadError && <ErrorNote onRetry={load}>{loadError}</ErrorNote>}

      <div className="dash-strip" style={{ "--cols": figures.length }}>
        {figures.map((f) => (
          <div key={f.label} className="dash-fig">
            <span className="dash-fig-label">{f.label}</span>
            <span className="dash-fig-value">{f.value}</span>
          </div>
        ))}
      </div>

      <PlanChangeRequests showToast={showToast} reloadKey={reloadKey} />

      <Section title="School Billing Status" flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : schools.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="schools" title="No schools found" text="Schools appear here once a Plan Inquiry is approved." />
          </div>
        ) : (
          <TableWrap>
            <table className="k-table is-hover is-stack">
              <thead>
                <tr>
                  {["School", "Plan", "Payment", "Subscription", "Expiry", "Action"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr key={school.id}>
                    <td className="is-title">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{school.name}</span>
                        {school.is_suspended && (
                          <Pill tone="red" size="sm">
                            <Pause size={11} aria-hidden="true" className="mr-1 inline-block align-[-1px]" />
                            Paused
                          </Pill>
                        )}
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
                    <td data-label="Payment">
                      <Pill tone={school.payment === "paid" ? "green" : "slate"}>{school.payment === "paid" ? "Paid" : "Unpaid"}</Pill>
                    </td>
                    <td data-label="Subscription">
                      <Pill tone={SUBSCRIPTION_TONE[school.subscription_status] ?? "slate"} className="capitalize">
                        {String(school.subscription_status ?? "—").replace(/_/g, " ")}
                      </Pill>
                    </td>
                    <td data-label="Expiry">{school.expiry}</td>
                    <td className="is-actions">
                      <Btn sm href={`/superadmin/schools?highlight=${school.id}`} aria-label={`Manage ${school.name}`}>
                        Manage <NavIcon name="arrow" size={14} />
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </Page>
  );
}
