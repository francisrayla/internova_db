"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
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
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
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
      setLastLiveUpdate(new Date());
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search school name"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none">
            {FILTERS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <div className="group relative flex shrink-0 items-center">
            <span className="grid h-6 w-6 cursor-help place-items-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500">
              i
            </span>
            <div className="pointer-events-none absolute left-0 top-8 z-10 w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition group-hover:opacity-100">
              Schools are created from approved Plan Inquiries. A school becomes fully active once its primary coordinator accepts the subscription offer and payment is confirmed.
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {["School", "Plan", "Account Setup", "Payment", "Subscription", "Action"].map((h) => (
                  <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-slate-500">Loading schools…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-slate-500">No schools found</td></tr>
              ) : (
                filtered.map((school) => (
                  <tr
                    key={school.id}
                    className={`hover:bg-slate-50 ${String(school.id) === String(highlightId) ? "bg-blue-50/60" : ""}`}
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{school.name}</p>
                      <p className="text-xs text-slate-500">{school.admin_name}{school.admin_email ? ` · ${school.admin_email}` : ""}</p>
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
                      <Pill ok={school.account_setup === "active"} okLabel="Active" badLabel="Invitation Pending" />
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Manage School Modal */}
      {manageSchool && (
        <Modal
          title={manageSchool.name}
          subtitle={manageSchool.admin_name ? `Coordinator: ${manageSchool.admin_name}` : undefined}
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
              <div className="flex justify-between"><span className="text-slate-500">Coordinator</span><span className="font-semibold text-slate-900">{manageSchool.admin_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Account Setup</span><Pill ok={manageSchool.account_setup === "active"} okLabel="Active" badLabel="Invitation Pending" /></div>
              <div className="flex justify-between"><span className="text-slate-500">Payment</span><Pill ok={manageSchool.payment === "paid"} okLabel="Paid" badLabel="Unpaid" /></div>
              <div className="flex justify-between"><span className="text-slate-500">Expiry</span><span className="font-semibold text-slate-900">{manageSchool.expiry}</span></div>
            </div>

            {manageSchool.is_suspended ? (
              // Paused overrides whatever lifecycle stage the school is in below it —
              // that stage is preserved (see the Status row above) and picks back up
              // automatically once access is restored.
              <>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800">
                  Access is paused — the coordinator sees a read-only notice and can&apos;t use the dashboard until you restore access. Nothing was deleted.
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
                {manageSchool.account_setup !== "active" && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                    Waiting for the school admin ({manageSchool.admin_email}) to log in and set up their account.
                  </div>
                )}

                {manageSchool.status === "awaiting_acceptance" && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
                    Subscription offer sent to {manageSchool.admin_email}. Waiting for them to review and accept it.
                    {manageSchool.offer_expires_at && <> Expires {manageSchool.offer_expires_at} if unanswered.</>}
                  </div>
                )}

                {manageSchool.status === "offer_expired" && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-rose-800">
                      This offer expired before {manageSchool.admin_email} accepted or paid.
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
                    {manageSchool.admin_email} accepted the offer and is choosing a payment method.
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
