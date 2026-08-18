"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

const REQUEST_STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Plan Change Requests</h2>
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{pending.length} pending</span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading requests…</p>
      ) : requests.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No plan change requests yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {[...pending, ...reviewed.slice(0, 5)].map((req) => (
            <div key={req.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{req.school_name}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {req.current_plan ?? "—"} ({req.current_billing_period ?? "—"}) → <strong className="text-slate-700">{req.requested_plan}</strong> ({req.requested_billing_period}) · list price ₱{Number(req.list_price ?? 0).toLocaleString()}
                  </p>
                  {req.note && <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">&ldquo;{req.note}&rdquo;</p>}
                  <p className="mt-1 text-xs text-slate-400">{req.submitted_at}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${REQUEST_STATUS_STYLE[req.status]}`}>{req.status}</span>
              </div>

              {req.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => openApprove(req)}
                    disabled={busy}
                    className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(req)}
                    disabled={busy}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reviewing && (
        <Modal title={`Approve — ${reviewing.school_name}`} onClose={() => setReviewing(null)}>
          <form onSubmit={handleApprove} className="space-y-4">
            <p className="text-sm text-slate-600">
              Switching to <strong>{reviewing.requested_plan}</strong> ({reviewing.requested_billing_period}) — list price ₱{Number(reviewing.list_price ?? 0).toLocaleString()}.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Discount Amount (optional)</span>
              <input
                type="number"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">
                Agreement Note {Number(discount || 0) > 0 && <span className="text-red-500">*</span>}
              </span>
              <textarea
                rows={2}
                required={Number(discount || 0) > 0}
                value={agreementNote}
                onChange={(e) => setAgreementNote(e.target.value)}
                placeholder="Reason for the discount / special terms"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <p className="text-sm font-semibold text-slate-900">
              Final amount: ₱{Math.max(0, Number(reviewing.list_price ?? 0) - Number(discount || 0)).toLocaleString()}
            </p>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? "Applying…" : "Approve & Apply"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

const PAYMENT_STYLE = {
  paid: "bg-blue-100 text-blue-700",
  unpaid: "bg-slate-100 text-slate-500",
};

const SUBSCRIPTION_STYLE = {
  active: "bg-blue-100 text-blue-700",
  expired: "bg-red-100 text-red-700",
  offer_expired: "bg-rose-100 text-rose-700",
  pending_payment: "bg-amber-100 text-amber-700",
  awaiting_acceptance: "bg-cyan-100 text-cyan-700",
  accepted: "bg-cyan-100 text-cyan-700",
};

export default function BillingPage() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const echoChannelRef = useRef(null);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  function load() {
    fetchSuperadminData("schools")
      .then((r) => setSchools(r.schools ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    echoChannelRef.current = echo.channel("superadmin-notifications").listen(".notification.created", handlePush);

    return () => {
      echo.channel("superadmin-notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
  }, []);

  const activeSchools = schools.filter((s) => s.subscription_status === "active");
  const monthlyRevenue = activeSchools.reduce((sum, s) => {
    const amount = Number(s.amount ?? 0);
    return sum + (s.billing_period === "yearly" ? amount / 12 : amount);
  }, 0);
  const pendingCount = schools.filter((s) => s.subscription_status === "pending_payment").length;
  const pausedCount = schools.filter((s) => s.is_suspended).length;

  return (
    <div className="space-y-6">
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">{toast}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Subscriptions</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{activeSchools.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. Monthly Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">₱{monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending Payment</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paused</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{pausedCount}</p>
        </div>
      </section>

      <PlanChangeRequests showToast={showToast} reloadKey={reloadKey} />

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="font-semibold text-slate-900">School Billing Status</h2>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Live{lastLiveUpdate ? ` — updated ${lastLiveUpdate.toLocaleTimeString()}` : ""}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["School", "Plan", "Payment", "Subscription", "Expiry", "Action"].map((h) => (
                <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-slate-500">Loading schools…</td></tr>
            ) : schools.length === 0 ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-slate-500">No schools found</td></tr>
            ) : (
              schools.map((school) => (
                <tr key={school.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-medium text-slate-900">
                    {school.name}
                    {school.is_suspended && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">⏸ Paused</span>
                    )}
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
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PAYMENT_STYLE[school.payment] ?? "bg-slate-100 text-slate-500"}`}>
                      {school.payment === "paid" ? "Paid" : "Unpaid"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${SUBSCRIPTION_STYLE[school.subscription_status] ?? "bg-slate-100 text-slate-500"}`}>
                      {String(school.subscription_status ?? "—").replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{school.expiry}</td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/superadmin/schools?highlight=${school.id}`}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
