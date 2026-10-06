"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";
import BillingBreakdown from "@/components/BillingBreakdown";

import { inputProps } from "@/lib/inputRules";
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

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Pill({ ok, okLabel, badLabel }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      ok ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
    }`}>
      {ok ? okLabel : badLabel}
    </span>
  );
}

function overallStatusMeta(status) {
  const map = {
    pending_setup:       { label: "Pending Setup",       color: "bg-slate-100 text-slate-600" },
    awaiting_acceptance: { label: "Awaiting Acceptance",  color: "bg-blue-100 text-blue-700" },
    accepted:            { label: "Accepted",             color: "bg-cyan-100 text-cyan-700" },
    pending_payment:     { label: "Pending Payment",      color: "bg-amber-100 text-amber-700" },
    active:              { label: "Active",               color: "bg-blue-100 text-blue-700" },
    offer_expired:       { label: "Offer Expired",        color: "bg-rose-100 text-rose-700" },
    past_due:            { label: "Past Due",             color: "bg-orange-100 text-orange-700" },
    expired:             { label: "Expired",              color: "bg-slate-200 text-slate-500" },
  };
  return map[status] ?? { label: status, color: "bg-slate-100 text-slate-600" };
}

// The Dean owns billing. A legacy school (registered before the Dean role) has
// none yet: invite one here, or resend / correct the invitation while pending.
function DeanInvite({ school, onDone }) {
  const [form, setForm] = useState({ name: "", email: "" });
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
        className="space-y-2 rounded-2xl border border-slate-200 p-4"
      >
        <p className="text-sm font-semibold text-slate-800">No dean yet</p>
        <p className="text-xs text-slate-500">The Dean accepts the plan, pays and invites the coordinator. They get an email link to set their own password.</p>
        <input {...inputProps("fullName")} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name of the Dean" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
        <input {...inputProps("email")} required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.trim() }))} placeholder="Email of the Dean" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? "Sending…" : "Invite Dean"}
        </button>
      </form>
    );
  }

  if (school.dean_setup === "pending") {
    return (
      <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-800">Waiting for the Dean ({school.dean_email}) to accept the invitation and set a password.</p>
        <input {...inputProps("email")} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => send("resend-dean-invitation", email !== school.dean_email ? { email } : {})}
          className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Sending…" : email !== school.dean_email ? "Change Email & Resend" : "↻ Resend Invitation"}
        </button>
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
  const [toast, setToast] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmingPauseId, setConfirmingPauseId] = useState(null); // holds the school id being confirmed, never a stale boolean
  const hasAutoOpenedHighlight = useRef(false);
  const echoChannelRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

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
    echoChannelRef.current = echo.channel("superadmin-notifications").listen(".notification.created", handlePush);

    return () => {
      echo.channel("superadmin-notifications").stopListening(".notification.created", handlePush);
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
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input {...inputProps("search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search school name"
            className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 sm:w-auto" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500">
            {FILTERS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <div className="group relative flex shrink-0 items-center">
            <span className="grid h-6 w-6 cursor-help place-items-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500">
              i
            </span>
            <div className="pointer-events-none absolute right-0 top-8 z-10 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition group-hover:opacity-100">
              Schools are created from approved Plan Inquiries. A school becomes fully active once its Dean accepts the subscription offer and payment is confirmed.
            </div>
          </div>
          <Link
            href="/superadmin/inquiries"
            className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Plan Inquiries →
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">Loading schools…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">No schools found</p>
        ) : (
          <>
            {/* Cards below sm: — the desktop table's 6 columns (School, Plan,
                Account Setup, Payment, Subscription, Action) never fit a
                phone width; forcing them to meant either an unreadable
                horizontal scrollbar or columns clipped off past the edge. */}
            <div className="divide-y divide-slate-100 sm:hidden">
              {filtered.map((school) => (
                <button
                  key={school.id}
                  type="button"
                  onClick={() => {
                    if (manageSchool?.id === school.id) {
                      setManageSchool(null);
                    } else {
                      setManageSchool(school);
                    }
                    setConfirmingPauseId(null);
                  }}
                  className={`block w-full px-5 py-4 text-left ${String(school.id) === String(highlightId) ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{school.name}</p>
                      <p className="truncate text-xs text-slate-500">{school.dean_email ? `Dean: ${school.dean_name} · ${school.dean_email}` : "No dean yet"}</p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Manage</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {(() => { const m = overallStatusMeta(school.status); return (
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.color}`}>{m.label}</span>
                    ); })()}
                    {school.is_suspended && (
                      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">⏸ Paused</span>
                    )}
                    {school.dean_email ? <Pill ok={school.dean_setup === "active"} okLabel="Dean active" badLabel="Dean invited" /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">No dean</span>}
                    <Pill ok={school.payment === "paid"} okLabel="Paid" badLabel="Unpaid" />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {school.plan}
                    {school.amount != null && ` · ₱${Number(school.amount).toLocaleString()} / ${school.billing_period === "monthly" ? "mo" : "yr"}`}
                  </p>
                </button>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["School", "Plan", "Dean", "Payment", "Subscription", "Action"].map((h) => (
                      <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filtered.map((school) => (
                    <tr
                      key={school.id}
                      className={`hover:bg-slate-50 ${String(school.id) === String(highlightId) ? "bg-blue-50/60" : ""}`}
                    >
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-900">{school.name}</p>
                        <p className="text-xs text-slate-500">{school.admin_email ? `Coordinator: ${school.admin_name}` : "No coordinator yet"}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {school.plan}
                        {school.amount != null && (
                          <span className="block text-xs text-slate-400">
                            ₱{Number(school.amount).toLocaleString()} / {school.billing_period === "monthly" ? "mo" : "yr"}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {school.dean_email ? (
                          <>
                            <p className="text-xs font-medium text-slate-900">{school.dean_name}</p>
                            <p className="mb-1 text-xs text-slate-500">{school.dean_email}</p>
                            <Pill ok={school.dean_setup === "active"} okLabel="Active" badLabel="Invitation Pending" />
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">No dean yet</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Pill ok={school.payment === "paid"} okLabel="Paid" badLabel="Unpaid" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(() => { const m = overallStatusMeta(school.status); return (
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.color}`}>{m.label}</span>
                          ); })()}
                          {school.is_suspended && (
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">⏸ Paused</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
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
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >Manage</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Manage School Modal */}
      {manageSchool && (
        <Modal
          title={manageSchool.name}
          subtitle={manageSchool.dean_name ? `Dean: ${manageSchool.dean_name}` : "No dean yet"}
          onClose={() => { setManageSchool(null); setConfirmingPauseId(null); }}
        >
          <div className="space-y-3">
            <div className="rounded-2xl bg-slate-50 p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className="flex gap-1.5">
                  {(() => { const m = overallStatusMeta(manageSchool.status); return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.color}`}>{m.label}</span>; })()}
                  {manageSchool.is_suspended && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">⏸ Paused</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{manageSchool.plan}</span></div>
              {manageSchool.amount != null && (
                <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-semibold text-slate-900">₱{Number(manageSchool.amount).toLocaleString()} / {manageSchool.billing_period === "monthly" ? "mo" : "yr"}</span></div>
              )}
              {manageSchool.scheduled_switch && (
                <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Scheduled switch: <strong>{manageSchool.scheduled_switch.plan} ({manageSchool.scheduled_switch.billing_period})</strong> starts {manageSchool.scheduled_switch.starts_on}, billed ₱{Number(manageSchool.scheduled_switch.amount ?? 0).toLocaleString()} then.
                </div>
              )}
              <BillingBreakdown breakdown={manageSchool.breakdown} title="Subscription price breakdown" />
              <div className="flex justify-between"><span className="text-slate-500">Dean</span><span className="font-semibold text-slate-900">{manageSchool.dean_name ?? "None yet"}</span></div>
              {manageSchool.dean_email && (
                <div className="flex justify-between"><span className="text-slate-500">Dean Setup</span><Pill ok={manageSchool.dean_setup === "active"} okLabel="Active" badLabel="Invitation Pending" /></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Coordinator</span><span className="font-semibold text-slate-900">{manageSchool.admin_name || "None yet"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Payment</span><Pill ok={manageSchool.payment === "paid"} okLabel="Paid" badLabel="Unpaid" /></div>
              <div className="flex justify-between"><span className="text-slate-500">Expiry</span><span className="font-semibold text-slate-900">{manageSchool.expiry}</span></div>
            </div>

            {manageSchool.is_suspended ? (
              // Paused overrides whatever lifecycle stage the school is in below it —
              // that stage is preserved (see the Status row above) and picks back up
              // automatically once access is restored.
              <>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800">
                  Access is paused — the school&apos;s coordinator sees a read-only notice and can&apos;t use the dashboard until you restore access. Nothing was deleted.
                </div>
                <button
                  onClick={() => handleToggleSuspend(manageSchool)}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  ▶ Restore School Access
                </button>
              </>
            ) : (
              <>
                <DeanInvite
                  key={manageSchool.id}
                  school={manageSchool}
                  onDone={(message) => { showToast(message); setManageSchool(null); load(); }}
                />

                {manageSchool.status === "awaiting_acceptance" && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
                    Subscription offer sent to {manageSchool.dean_email ?? manageSchool.admin_email}. Waiting for the Dean to review and accept it.
                    {manageSchool.offer_expires_at && <> Expires {manageSchool.offer_expires_at} if unanswered.</>}
                  </div>
                )}

                {manageSchool.status === "offer_expired" && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-rose-800">
                      This offer expired before {manageSchool.dean_email ?? manageSchool.admin_email} accepted or paid.
                    </p>
                    <button
                      onClick={() => handleResendOffer(manageSchool)}
                      disabled={confirming}
                      className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {confirming ? "Sending…" : "↻ Send New Offer"}
                    </button>
                  </div>
                )}

                {manageSchool.status === "accepted" && (
                  <div className="rounded-xl bg-cyan-50 border border-cyan-200 px-4 py-3 text-xs text-cyan-800">
                    {manageSchool.dean_email ?? manageSchool.admin_email} accepted the offer and is choosing a payment method.
                  </div>
                )}

                {manageSchool.status === "pending_payment" && manageSchool.payment_status === "pending_verification" && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-amber-800">Bank transfer proof submitted — review before verifying.</p>
                    {manageSchool.proof_of_payment_url && (
                      <a
                        href={manageSchool.proof_of_payment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-xs font-semibold text-blue-700 underline"
                      >
                        View Uploaded Proof →
                      </a>
                    )}
                    <button
                      onClick={() => handleVerifyPayment(manageSchool)}
                      disabled={confirming}
                      className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {confirming ? "Verifying…" : "✓ Verify & Activate Subscription"}
                    </button>
                  </div>
                )}

                {manageSchool.status === "pending_payment" && manageSchool.payment_status !== "pending_verification" && manageSchool.payment !== "paid" && (
                  <button
                    onClick={() => handleConfirmPayment(manageSchool)}
                    disabled={confirming}
                    className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {confirming ? "Confirming…" : "✓ Confirm Payment Received (manual override)"}
                  </button>
                )}

                {manageSchool.status === "active" && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
                    This school is fully active. Premium/Basic features are enabled per their plan.
                  </div>
                )}

                {manageSchool.status === "active" && confirmingPauseId !== manageSchool.id && (
                  <button
                    onClick={() => setConfirmingPauseId(manageSchool.id)}
                    className="w-full rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    ⏸ Pause School Access
                  </button>
                )}

                {manageSchool.status === "active" && confirmingPauseId === manageSchool.id && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                    <p className="text-xs text-red-800">
                      Pause access for <strong>{manageSchool.name}</strong>? Their coordinator won&apos;t be able to use the dashboard until you restore it — you can undo this any time.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleSuspend(manageSchool)}
                        className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
                      >
                        Yes, Pause Access
                      </button>
                      <button
                        onClick={() => setConfirmingPauseId(null)}
                        className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
