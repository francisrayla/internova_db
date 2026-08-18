"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

const PLAN_FEATURES = {
  Basic: [
    "GPS + Selfie Attendance",
    "Task Management (Pending / Ongoing / Done)",
    "Basic Monitoring & Reports",
  ],
  Premium: [
    "GPS + Selfie Attendance",
    "Subtasks, Attachments, Task Comments",
    "Real-time Chat",
    "Per-task Rating & Formal Evaluations",
    "AI Portfolio & Reports",
  ],
};

const PAYMENT_METHODS = [
  { id: "gcash", label: "GCash", icon: "📱", testMode: true },
  { id: "maya", label: "Maya", icon: "💳", testMode: true },
  { id: "card", label: "Debit / Credit Card", icon: "💳", testMode: true },
  { id: "bank_transfer", label: "Bank Transfer", icon: "🏦", testMode: false },
];

// Published list prices — matches SubscriptionPlan::PRICES on the backend.
// Self-service switching only ever uses these rates; anything else goes through
// a Super Admin-reviewed request.
const PLAN_PRICES = {
  Basic: { monthly: 1500, yearly: 15000 },
  Premium: { monthly: 3500, yearly: 35000 },
};

function Shell({ children }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 sm:p-10 shadow-xl text-center">
        {children}
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(null); // { validUntil } after simulated online payment
  const [billingToggle, setBillingToggle] = useState("monthly"); // browsing period for the plan comparison
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchMessage, setSwitchMessage] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPlan, setRequestPlan] = useState(null);
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [upgradeFlow, setUpgradeFlow] = useState(null); // { plan, period, price, step: 'confirm' | 'payment' }
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  function loadUser() {
    const raw = localStorage.getItem("internova_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    setUser(parsed);
    return parsed;
  }

  useEffect(() => {
    const loaded = loadUser();
    // Returning from PayMongo's hosted checkout page — re-confirm payment status
    // with PayMongo directly instead of trusting the redirect itself.
    const params = new URLSearchParams(window.location.search);
    if (loaded?.school_id && params.get("paid") === "1") {
      setVerifying(true);
      apiFetch(`/api/coordinator/schools/${loaded.school_id}/verify-checkout`, { method: "POST" })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.message || "Payment could not be verified yet.");
          return data;
        })
        .then((data) => {
          // Refetch the full session (not just patch fields) — an upgrade payment
          // changes the plan itself, not just the status.
          return apiFetch(`/api/auth/session/${loaded.id}`)
            .then((r) => r.json())
            .then((sessionData) => {
              if (sessionData.success) {
                localStorage.setItem("internova_user", JSON.stringify(sessionData.user));
                setUser(sessionData.user);
              }
              setPaymentSuccess({ validUntil: data.valid_until });
            });
        })
        .catch((err) => setError(err.message))
        .finally(() => {
          setVerifying(false);
          window.history.replaceState({}, "", "/coordinator/subscription");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistUser(patch) {
    const updated = { ...user, ...patch };
    localStorage.setItem("internova_user", JSON.stringify(updated));
    setUser(updated);
    return updated;
  }

  function handleAccept() {
    setBusy(true);
    setError("");
    apiFetch(`/api/coordinator/schools/${user.school_id}/accept-offer`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not accept the offer.");
        return data;
      })
      .then(() => {
        persistUser({ subscription_status: "accepted" });
        setCheckoutOpen(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function handleChoosePayment(method) {
    setBusy(true);
    setError("");
    apiFetch(`/api/coordinator/schools/${user.school_id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method: method }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Checkout failed.");
        return data;
      })
      .then((data) => {
        if (data.method === "bank_transfer") {
          persistUser({ subscription_status: "pending_payment", payment_method: "bank_transfer", payment_status: "pending", payment_reference: data.reference });
          setBusy(false);
        } else {
          // Hand off to PayMongo's hosted checkout page (test mode) — stay busy
          // until the browser actually navigates away.
          window.location.href = data.checkout_url;
        }
      })
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }

  function handleUploadProof(e) {
    e.preventDefault();
    if (!proofFile) {
      setError("Please choose a file first.");
      return;
    }
    setBusy(true);
    setError("");

    const formData = new FormData();
    formData.append("proof", proofFile);

    apiFetch(`/api/coordinator/schools/${user.school_id}/upload-proof`, {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Upload failed.");
        return data;
      })
      .then(() => {
        if (user.pending_upgrade) {
          persistUser({ pending_upgrade: { ...user.pending_upgrade, payment_status: "pending_verification" } });
        } else {
          persistUser({ payment_status: "pending_verification" });
        }
        setProofFile(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function handleOpenUpgrade(planName, period) {
    setError("");
    setUpgradeFlow({ plan: planName, period, step: "confirm", loading: true });
    apiFetch(`/api/coordinator/schools/${user.school_id}/upgrade-quote?plan_name=${planName}&billing_period=${period}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not calculate the upgrade price.");
        return data.quote;
      })
      .then((quote) => {
        setUpgradeFlow({ plan: planName, period, step: "confirm", quote, loading: false });
      })
      .catch((err) => {
        setError(err.message);
        setUpgradeFlow(null);
      });
  }

  function handleUpgradePayment(method) {
    setUpgradeBusy(true);
    setError("");
    apiFetch(`/api/coordinator/schools/${user.school_id}/upgrade-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: upgradeFlow.plan, billing_period: upgradeFlow.period, payment_method: method }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not start the upgrade.");
        return data;
      })
      .then((data) => {
        if (data.method === "bank_transfer") {
          persistUser({
            pending_upgrade: {
              plan: upgradeFlow.plan,
              billing_period: upgradeFlow.period,
              amount: data.amount,
              payment_method: "bank_transfer",
              payment_status: "pending",
              payment_reference: data.reference,
            },
          });
          setUpgradeFlow(null);
          setUpgradeBusy(false);
        } else {
          window.location.href = data.checkout_url;
        }
      })
      .catch((err) => {
        setError(err.message);
        setUpgradeBusy(false);
      });
  }

  function handleSwitchPlan(planName, period) {
    setSwitchBusy(true);
    setSwitchMessage("");
    setError("");
    apiFetch(`/api/coordinator/schools/${user.school_id}/switch-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: planName, billing_period: period }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not switch plans.");
        return data;
      })
      .then((data) => {
        persistUser({
          subscription_plan: data.plan,
          subscription_billing_period: period,
          subscription_amount: data.amount,
          subscription_end_date: data.valid_until,
        });
        setSwitchMessage(`Switched to ${data.plan} (${period}). Now valid until ${data.valid_until}.`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSwitchBusy(false));
  }

  function handleRequestChange(e) {
    e.preventDefault();
    setRequestBusy(true);
    setError("");
    apiFetch(`/api/coordinator/schools/${user.school_id}/request-plan-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: requestPlan.name, billing_period: requestPlan.period, note: requestNote }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not send the request.");
        return data;
      })
      .then(() => {
        setRequestDone(true);
        setRequestOpen(false);
        setRequestNote("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setRequestBusy(false));
  }

  if (!user) return null;

  const status = user.subscription_status;
  const features = PLAN_FEATURES[user.subscription_plan] || PLAN_FEATURES.Basic;

  // Returned from PayMongo's hosted checkout — confirming payment status server-side
  if (verifying) {
    return (
      <Shell>
        <div className="text-5xl">⏳</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Confirming your payment…</h1>
        <p className="mt-3 text-slate-600">Checking with PayMongo. This only takes a moment.</p>
      </Shell>
    );
  }

  // GCash/Maya/Card payment confirmed via PayMongo
  if (paymentSuccess) {
    return (
      <Shell>
        <div className="text-6xl">✅</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Payment Successful</h1>
        <p className="mt-3 text-slate-600">
          Your <strong>{user.subscription_plan}</strong> subscription is now active.
        </p>
        {paymentSuccess.validUntil && (
          <p className="mt-1 text-sm text-slate-500">Valid until: <strong>{paymentSuccess.validUntil}</strong></p>
        )}
        <button
          onClick={() => router.push("/coordinator/dashboard")}
          className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Go to Dashboard
        </button>
      </Shell>
    );
  }

  // Already active: show a plan summary + the option to switch or request a custom plan change
  if (status === "active") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-4xl">✅</div>
              <h1 className="mt-3 text-2xl font-bold text-slate-900">Subscription & Billing</h1>
              <p className="mt-1 text-slate-600"><strong>{user.school_name}</strong> is fully active.</p>
            </div>
            <Link
              href="/coordinator/dashboard"
              className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Dashboard
            </Link>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{user.subscription_plan}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Billing</span><span className="font-semibold text-slate-900 capitalize">{user.subscription_billing_period}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-semibold text-slate-900">₱{Number(user.subscription_amount ?? 0).toLocaleString()}</span></div>
            {user.subscription_start_date && (
              <div className="flex justify-between"><span className="text-slate-500">Start Date</span><span className="font-semibold text-slate-900">{user.subscription_start_date}</span></div>
            )}
            {user.subscription_end_date && (
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="text-slate-500">Valid Until</span><span className="font-bold text-blue-700">{user.subscription_end_date}</span></div>
            )}
          </div>

          {switchMessage && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{switchMessage}</p>}
          {requestDone && <p className="mt-4 rounded-xl bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700">Request sent — the Super Admin will follow up with you.</p>}
          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</p>}
        </div>

        {user.pending_upgrade ? (
          <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⏳</span>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Upgrade to {user.pending_upgrade.plan} — Payment Pending</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Basic features stay usable. {user.pending_upgrade.plan} features unlock once payment is confirmed.
                </p>
              </div>
            </div>

            {user.pending_upgrade.payment_method === "bank_transfer" && user.pending_upgrade.payment_status === "pending_verification" && (
              <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
                <div className="flex justify-between"><span className="text-slate-500">Reference</span><span className="font-semibold text-slate-900">{user.pending_upgrade.payment_reference}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Proof</span><span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Uploaded — awaiting Super Admin review</span></div>
              </div>
            )}

            {user.pending_upgrade.payment_method === "bank_transfer" && user.pending_upgrade.payment_status === "pending" && (
              <>
                <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-slate-500">Bank</span><span className="font-semibold text-slate-900">BDO Unibank</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Account Name</span><span className="font-semibold text-slate-900">Internova AI Technologies Inc.</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Account Number</span><span className="font-semibold text-slate-900">0012-3456-7890</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Reference Code</span><span className="font-semibold text-slate-900">{user.pending_upgrade.payment_reference}</span></div>
                  <div className="flex justify-between border-t border-slate-200 pt-2"><span className="text-slate-500">Amount</span><span className="font-bold text-blue-700">₱{Number(user.pending_upgrade.amount ?? 0).toLocaleString()}</span></div>
                </div>
                <form onSubmit={handleUploadProof} className="mt-4 space-y-3 text-left">
                  <label className="block text-sm font-semibold text-slate-700">Upload Proof of Payment</label>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {busy ? "Uploading…" : "Submit Proof of Payment"}
                  </button>
                </form>
              </>
            )}

            {user.pending_upgrade.payment_method !== "bank_transfer" && (
              <p className="mt-5 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                Waiting for PayMongo payment confirmation. If you closed the payment window, return to complete it — this page automatically confirms once you do.
              </p>
            )}

            {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</p>}
          </div>
        ) : upgradeFlow ? (
          <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
            {upgradeFlow.loading ? (
              <p className="text-sm text-slate-500">Calculating your prorated upgrade price…</p>
            ) : upgradeFlow.step === "confirm" ? (
              <>
                <h2 className="text-lg font-bold text-slate-900">Upgrade to {upgradeFlow.plan}</h2>
                <p className="mt-1 text-sm text-slate-500">New features you will unlock:</p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  {PLAN_FEATURES[upgradeFlow.plan].map((f) => (
                    <li key={f} className="flex items-start gap-2"><span className="text-blue-600">✓</span><span>{f}</span></li>
                  ))}
                </ul>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-left text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-slate-500">{user.subscription_plan} price</span><span className="font-semibold text-slate-900">₱{upgradeFlow.quote.old_price.toLocaleString()}/{upgradeFlow.period === "monthly" ? "mo" : "yr"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{upgradeFlow.plan} price</span><span className="font-semibold text-slate-900">₱{upgradeFlow.quote.new_price.toLocaleString()}/{upgradeFlow.period === "monthly" ? "mo" : "yr"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Remaining period</span><span className="font-semibold text-slate-900">{upgradeFlow.quote.remaining_days} of {upgradeFlow.quote.total_days} days</span></div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">Upgrade amount today</span><span className="font-bold text-blue-700">₱{upgradeFlow.quote.amount_now.toLocaleString()}</span></div>
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  Starting next renewal: ₱{upgradeFlow.quote.next_renewal_price.toLocaleString()}/{upgradeFlow.period === "monthly" ? "mo" : "yr"}. Your renewal date stays {upgradeFlow.quote.current_end_date}.
                </p>
                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setUpgradeFlow((f) => ({ ...f, step: "payment" }))}
                    className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Continue to Payment
                  </button>
                  <button
                    onClick={() => setUpgradeFlow(null)}
                    className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-slate-900">Checkout</h2>
                <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Plan Upgrade</span><span className="font-semibold text-slate-900">{user.subscription_plan} → {upgradeFlow.plan}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Amount Due Today</span><span className="font-bold text-blue-700">₱{upgradeFlow.quote.amount_now.toLocaleString()}</span></div>
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-700">Choose Payment Method</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleUpgradePayment(m.id)}
                      disabled={upgradeBusy}
                      className="relative rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-60"
                    >
                      {m.icon} {m.label}
                      {m.testMode && (
                        <span className="absolute -top-2 -right-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">TEST MODE</span>
                      )}
                    </button>
                  ))}
                </div>
                {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>}
                <button onClick={() => setUpgradeFlow(null)} className="mt-3 text-sm font-medium text-slate-500 hover:text-slate-700">
                  ← Back
                </button>
              </>
            )}
          </div>
        ) : (
        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Available Plans</h2>
              <p className="mt-1 text-sm text-slate-500">Downgrades switch instantly. Upgrades require payment.</p>
            </div>
            <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
              {["monthly", "yearly"].map((period) => (
                <button
                  key={period}
                  onClick={() => setBillingToggle(period)}
                  className={`rounded-lg px-3 py-1.5 capitalize transition ${billingToggle === period ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Object.keys(PLAN_PRICES).map((planName) => {
              const isCurrent = user.subscription_plan === planName && user.subscription_billing_period === billingToggle;
              const price = PLAN_PRICES[planName][billingToggle];
              const isUpgrade = price > Number(user.subscription_amount ?? 0);
              const samePeriodAsCurrent = billingToggle === user.subscription_billing_period;
              return (
                <div key={planName} className={`rounded-2xl border p-5 text-left ${isCurrent ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-900">{planName}</p>
                    {isCurrent && <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">Current Plan</span>}
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    ₱{price.toLocaleString()}
                    <span className="text-sm font-medium text-slate-500"> / {billingToggle === "monthly" ? "mo" : "yr"}</span>
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-600">
                    {PLAN_FEATURES[planName].map((f) => (
                      <li key={f} className="flex items-start gap-2"><span className="text-blue-600">✓</span><span>{f}</span></li>
                    ))}
                  </ul>

                  {!isCurrent && isUpgrade && samePeriodAsCurrent && (
                    <button
                      onClick={() => handleOpenUpgrade(planName, billingToggle)}
                      className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Upgrade to {planName}
                    </button>
                  )}
                  {!isCurrent && isUpgrade && !samePeriodAsCurrent && (
                    <p className="mt-4 text-xs text-slate-400">Switch to your {user.subscription_billing_period} tab to upgrade.</p>
                  )}
                  {!isCurrent && !isUpgrade && (
                    <button
                      onClick={() => handleSwitchPlan(planName, billingToggle)}
                      disabled={switchBusy}
                      className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {switchBusy ? "Switching…" : `Switch to ${planName}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4 text-center">
            <p className="text-xs text-slate-400">Upgrades and instant switches use the standard rate above — no discounts.</p>
            <button
              onClick={() => { setRequestOpen((v) => !v); setRequestDone(false); }}
              className="mt-1 text-sm font-semibold text-blue-700 hover:underline"
            >
              Need a custom rate? Request a plan change →
            </button>
          </div>

          {requestOpen && (
            <form onSubmit={handleRequestChange} className="mt-4 space-y-3 rounded-2xl border border-slate-200 p-4 text-left">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold text-slate-700">Requested Plan</span>
                  <select
                    required
                    value={requestPlan?.name ?? ""}
                    onChange={(e) => setRequestPlan((p) => ({ period: p?.period ?? "monthly", ...p, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="" disabled>Select a plan</option>
                    <option value="Basic">Basic</option>
                    <option value="Premium">Premium</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold text-slate-700">Billing Period</span>
                  <select
                    required
                    value={requestPlan?.period ?? ""}
                    onChange={(e) => setRequestPlan((p) => ({ name: p?.name ?? "", ...p, period: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="" disabled>Select a period</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-slate-700">Message to Super Admin (optional)</span>
                <textarea
                  rows={3}
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="e.g. Ask about a discount, a custom start date, or special terms"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </label>
              <button
                type="submit"
                disabled={requestBusy}
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {requestBusy ? "Sending…" : "Send Request"}
              </button>
            </form>
          )}
        </div>
        )}
      </div>
    );
  }

  // Offer sat unanswered/unpaid past its window
  if (status === "offer_expired") {
    return (
      <Shell>
        <div className="text-5xl">⏰</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Subscription Offer Expired</h1>
        <p className="mt-3 text-slate-600">
          Your subscription offer for <strong>{user.school_name}</strong> has expired. Please contact your
          Super Admin to request a new offer.
        </p>
        <a
          href="mailto:hello@internova.ai"
          className="mt-6 block w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Contact Super Admin
        </a>      </Shell>
    );
  }

  // Waiting for Super Admin verification of an uploaded bank transfer proof
  if (status === "pending_payment" && user.payment_method === "bank_transfer" && user.payment_status === "pending_verification") {
    return (
      <Shell>
        <div className="text-5xl">🔍</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Payment Under Verification</h1>
        <p className="mt-3 text-slate-600">Your proof was submitted successfully. The Super Admin will verify it shortly.</p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
          <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{user.subscription_plan}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Payment Method</span><span className="font-semibold text-slate-900">Bank Transfer</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Reference</span><span className="font-semibold text-slate-900">{user.payment_reference}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Proof</span><span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Uploaded</span></div>
        </div>      </Shell>
    );
  }

  // Bank transfer chosen: show bank details + reference + upload form
  if (status === "pending_payment" && user.payment_method === "bank_transfer") {
    return (
      <Shell>
        <div className="text-5xl">🏦</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Bank Transfer Details</h1>
        <p className="mt-2 text-slate-600">Transfer the amount below, then upload your proof of payment.</p>

        <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
          <div className="flex justify-between"><span className="text-slate-500">Bank</span><span className="font-semibold text-slate-900">BDO Unibank</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Account Name</span><span className="font-semibold text-slate-900">Internova AI Technologies Inc.</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Account Number</span><span className="font-semibold text-slate-900">0012-3456-7890</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Reference Code</span><span className="font-semibold text-slate-900">{user.payment_reference}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-2"><span className="text-slate-500">Amount</span><span className="font-bold text-blue-700">₱{Number(user.subscription_amount ?? 0).toLocaleString()}</span></div>
        </div>

        <form onSubmit={handleUploadProof} className="mt-6 space-y-3 text-left">
          <label className="block text-sm font-semibold text-slate-700">Upload Proof of Payment</label>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          {error && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? "Uploading…" : "Submit Proof of Payment"}
          </button>
        </form>
      </Shell>
    );
  }

  // Offer accepted: choose a payment method
  if (status === "accepted" || checkoutOpen) {
    return (
      <Shell>
        <div className="text-5xl">💳</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Checkout</h1>
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-left text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{user.subscription_plan} — {user.subscription_billing_period}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Amount Due</span><span className="font-bold text-blue-700">₱{Number(user.subscription_amount ?? 0).toLocaleString()}</span></div>
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-700 text-left">Choose Payment Method</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => handleChoosePayment(m.id)}
              disabled={busy}
              className="relative rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-60"
            >
              {m.icon} {m.label}
              {m.testMode && (
                <span className="absolute -top-2 -right-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  TEST MODE
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-400">
          <strong>Test Mode</strong> — GCash, Maya, and Card go through PayMongo&apos;s sandbox checkout (no real money moves). Bank Transfer is fully functional and reviewed manually by the Super Admin.
        </p>

        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>}
      </Shell>
    );
  }

  // Default: awaiting_acceptance — review the offer
  return (
    <Shell>
      <div className="text-5xl">🎓</div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Welcome to Internova AI</h1>
      <p className="mt-2 text-slate-600">Your subscription offer for <strong>{user.school_name}</strong> is ready.</p>

      <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left text-sm space-y-2">
        <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{user.subscription_plan}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Billing</span><span className="font-semibold text-slate-900 capitalize">{user.subscription_billing_period}</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-2"><span className="text-slate-500">Amount Due</span><span className="font-bold text-blue-700">₱{Number(user.subscription_amount ?? 0).toLocaleString()}</span></div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 p-4 text-left">
        <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Included Features</p>
        <ul className="space-y-1.5 text-sm text-slate-700">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className="text-blue-600">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>}

      <button
        onClick={handleAccept}
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {busy ? "Processing…" : "Accept Plan & Proceed to Payment"}
      </button>
      <Link
        href="/coordinator/preview"
        className="mt-3 block w-full rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Preview {user.subscription_plan} Features
      </Link>
      <a
        href="mailto:hello@internova.ai"
        className="mt-3 block w-full text-center text-sm font-medium text-blue-700 hover:underline"
      >
        Contact Super Admin
      </a>
    </Shell>
  );
}
