"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";
import BillingBreakdown from "@/components/BillingBreakdown";
import NavIcon from "@/components/NavIcon";
import { Banner, Btn, FormField, KeyValueList, Page, PageHeader, Pill, Section, Select, Textarea, btnClass } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
import { BANK_DETAILS, PAYMENT_TEST_MODE, PLAN_PRICES } from "@/lib/billingConstants";
const PLAN_FEATURES = {
  Basic: [
    "GPS + Selfie Attendance",
    "Task Management (Pending / Ongoing / Done)",
    "Formal Evaluations (school's own criteria)",
    "Portfolio & Narrative Report (auto-generated, no AI)",
    "Messaging & Group Chat",
    "Basic Monitoring & Reports",
  ],
  Premium: [
    "Everything in Basic",
    "Subtasks and Attachments (proof of work)",
    "Task Comments and Per-task Rating",
    "AI Narrative Writing (AI-written and polished)",
  ],
};

const PAYMENT_METHODS = [
  { id: "gcash", label: "GCash", icon: "gcash", testMode: true },
  { id: "maya", label: "Maya", icon: "maya", testMode: true },
  { id: "card", label: "Debit / Credit Card", icon: "card", testMode: true },
  { id: "bank_transfer", label: "Bank Transfer", icon: "bank", testMode: false },
];

// Published list prices and bank details live in one shared module (lib/billingConstants.js).
// Self-service switching only ever uses these rates; anything else goes through
// a Super Admin-reviewed request.

// Full-page states before the subscription is active (offer, checkout, receipt ...): one centred card.
function Shell({ children }) {
  return (
    <Page size="narrow">
      <section className="dash-card space-y-5 max-sm:py-6">{children}</section>
    </Page>
  );
}

// Plain muted icon, title and one sentence at the top of a Shell.
function Hero({ icon, title, children }) {
  return (
    <div className="text-center">
      <NavIcon name={icon} size={30} className="mx-auto text-slate-500" />
      <h1 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
      {children && <p className="mt-2 text-sm text-slate-600 sm:text-base">{children}</p>}
    </div>
  );
}

// Label left, value right even on phones (the kit stacks them below 520px).
const KV = "max-[519px]:[&>div]:grid-cols-[minmax(0,1fr)_auto] max-[519px]:[&>div]:gap-x-4 max-[519px]:[&_dd]:text-right";
const money = (n) => `₱${Number(n ?? 0).toLocaleString()}`;
const Strong = ({ children }) => <strong className="font-semibold text-blue-700">{children}</strong>;

// The four payment buttons; the screen decides what picking one does.
function PaymentButtons({ onPick, disabled }) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onPick(m.id)}
          disabled={disabled}
          className={btnClass("secondary", { className: "h-auto flex-col gap-1 whitespace-normal py-3 max-sm:min-h-[56px]" })}
        >
          <span className="inline-flex items-center justify-center gap-2 text-center"><NavIcon name={m.icon} size={16} /> {m.label}</span>
          {m.testMode && PAYMENT_TEST_MODE && <span className="k-pill is-sm is-warn">Test mode</span>}
        </button>
      ))}
    </div>
  );
}

// "Included features" style bullet list with a Lucide check.
function FeatureList({ items, className = "" }) {
  return (
    <ul className={`space-y-2 text-sm text-slate-700 ${className}`}>
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <NavIcon name="check" size={16} className="mt-0.5 shrink-0 text-emerald-700" />
          <span className="min-w-0">{f}</span>
        </li>
      ))}
    </ul>
  );
}

const METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m.label]));

export default function SubscriptionPage() {
  const router = useRouter();
  // The dean layout owns the access gate (billing-only vs full app) and
  // decides it from its own copy of the user — every status change made here
  // has to reach it too, or the gate keeps acting on the pre-payment status.
  const { onUserUpdated } = useCurrentUser();
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(null); // { validUntil, user } after a confirmed PayMongo payment
  const [billingToggle, setBillingToggle] = useState("monthly"); // browsing period for the plan comparison
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchMessage, setSwitchMessage] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPlan, setRequestPlan] = useState(null);
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [renewPlan, setRenewPlan] = useState("");
  const [renewPeriod, setRenewPeriod] = useState("");
  const [offerRequested, setOfferRequested] = useState("");
  const [changeMethod, setChangeMethod] = useState(false); // bank transfer chosen, no proof yet: pick another method
  const [upgradeFlow, setUpgradeFlow] = useState(null); // { plan, period, price, step: 'confirm' | 'payment' }
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  function loadUser() {
    const raw = localStorage.getItem("internova_user");
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null; // a damaged saved login: treat it as not signed in
    }
    setUser(parsed);
    return parsed;
  }

  // Re-confirms payment with PayMongo (server-side) and shows the receipt. Used when the Dean
  // returns from PayMongo's hosted page and by the "I already paid" button.
  function confirmWithPayMongo(loaded) {
    if (!loaded?.school_id) return;
    setVerifying(true);
    setError("");
    apiFetch(`/api/dean/schools/${loaded.school_id}/verify-checkout`, { method: "POST" })
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
            const freshUser = sessionData.success ? sessionData.user : null;
            if (freshUser) {
              localStorage.setItem("internova_user", JSON.stringify(freshUser));
              setUser(freshUser);
            }
            // The layout is told about the now-active status only when the
            // coordinator leaves this receipt (see handleFinishPayment):
            // flipping its gate now would swap billing-only chrome for the
            // full app shell, remounting this page and losing the receipt.
            setPaymentSuccess({ validUntil: data.valid_until, user: freshUser });
          });
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setVerifying(false);
        // router.replace (not window.history.replaceState) — the latter edits
        // the URL bar behind Next.js's back, which desyncs its App Router
        // state and makes the very next router.push (the "Go to Dashboard"
        // button below) fall back to a full page reload instead of a clean
        // client-side transition.
        router.replace("/dean/billing");
      });
  }

  useEffect(() => {
    const loaded = loadUser();
    // Returning from PayMongo's hosted checkout page — re-confirm payment status
    // with PayMongo directly instead of trusting the redirect itself.
    const params = new URLSearchParams(window.location.search);
    if (loaded?.school_id && params.get("paid") === "1") {
      confirmWithPayMongo(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistUser(patch) {
    const updated = { ...user, ...patch };
    localStorage.setItem("internova_user", JSON.stringify(updated));
    setUser(updated);
    onUserUpdated(updated);
    return updated;
  }

  // Leaving the payment receipt: unlock the full app in the layout first, so
  // the dashboard it navigates to isn't bounced straight back to billing.
  function handleFinishPayment() {
    if (paymentSuccess?.user) onUserUpdated(paymentSuccess.user);
    router.push("/dean/dashboard");
  }

  function handleAccept() {
    setBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/accept-offer`, { method: "POST" })
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
    apiFetch(`/api/dean/schools/${user.school_id}/checkout`, {
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
          setChangeMethod(false);
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

  // Expired term: opens a renewal (same plan by default), then the normal checkout takes over.
  function handleRenew() {
    setBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/renew`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: renewPlan || user.subscription_plan, billing_period: renewPeriod || user.subscription_billing_period }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not start the renewal.");
        return data;
      })
      .then(() => apiFetch(`/api/auth/session/${user.id}`).then((r) => r.json()))
      .then((sessionData) => {
        if (sessionData.success) persistUser(sessionData.user);
        setChangeMethod(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function handleRequestNewOffer() {
    setBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/request-new-offer`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not send the request.");
        return data;
      })
      .then((data) => setOfferRequested(data.message))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
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

    apiFetch(`/api/dean/schools/${user.school_id}/upload-proof`, {
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
    apiFetch(`/api/dean/schools/${user.school_id}/upgrade-quote?plan_name=${planName}&billing_period=${period}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not calculate the upgrade price.");
        return data;
      })
      .then(({ quote, breakdown, kind }) => {
        setUpgradeFlow({ plan: planName, period, step: "confirm", quote, breakdown, kind, loading: false });
      })
      .catch((err) => {
        setError(err.message);
        setUpgradeFlow(null);
      });
  }

  function handleUpgradePayment(method) {
    setUpgradeBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/upgrade-plan`, {
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

  // Undoes an abandoned PayMongo checkout (closed the tab, hit back, etc.) —
  // without this, requestUpgrade's "one pending upgrade at a time" guard on
  // the backend leaves the coordinator stuck: unable to retry (blocked) and
  // unable to finish (the checkout session is gone). `reopen` immediately
  // re-launches the same plan/period's upgrade dialog from a clean quote
  // instead of resubmitting the old one — proration is time-sensitive, so a
  // fresh quote is safer than trusting a price the coordinator saw earlier.
  function handleCancelPendingUpgrade(reopen) {
    const plan = user.pending_upgrade?.plan;
    const period = user.pending_upgrade?.billing_period;
    setUpgradeBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/cancel-pending-upgrade`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not cancel the pending upgrade.");
        return data;
      })
      .then(() => {
        persistUser({ pending_upgrade: null });
        if (reopen && plan && period) handleOpenUpgrade(plan, period);
      })
      .catch((err) => setError(err.message))
      .finally(() => setUpgradeBusy(false));
  }

  // Pay for a Super Admin-approved plan change: the normal checkout (PayMongo or bank transfer).
  function handlePayApprovedChange(method) {
    setBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/checkout`, {
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
          // Becomes a pending upgrade (bank details + proof upload) - refetch the session for it.
          return apiFetch(`/api/auth/session/${user.id}`)
            .then((r) => r.json())
            .then((sessionData) => {
              if (sessionData.success) persistUser(sessionData.user);
              setBusy(false);
            });
        }
        window.location.href = data.checkout_url;
      })
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }

  function handleCancelApprovedChange() {
    setBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/cancel-pending-upgrade`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not cancel the approved change.");
        persistUser({ approved_change: null });
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function handleSwitchPlan(planName, period) {
    setSwitchBusy(true);
    setSwitchMessage("");
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/switch-plan`, {
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
        // The paid term is never cut short: the switch is scheduled for when it ends.
        persistUser({ scheduled_switch: data.scheduled_switch });
        setSwitchMessage(data.message);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSwitchBusy(false));
  }

  function handleCancelScheduledSwitch() {
    setSwitchBusy(true);
    setSwitchMessage("");
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/cancel-scheduled-switch`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Could not cancel the scheduled switch.");
        return data;
      })
      .then((data) => {
        persistUser({ scheduled_switch: null });
        setSwitchMessage(data.message);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSwitchBusy(false));
  }

  function handleRequestChange(e) {
    e.preventDefault();
    setRequestBusy(true);
    setError("");
    apiFetch(`/api/dean/schools/${user.school_id}/request-plan-change`, {
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
        <Hero icon="attendance" title="Confirming your payment…">Checking with PayMongo. This only takes a moment.</Hero>
      </Shell>
    );
  }

  // GCash/Maya/Card payment confirmed via PayMongo
  if (paymentSuccess) {
    const paid = paymentSuccess.user ?? user;
    const rows = [
      ["School", paid.school_name],
      ["Plan", paid.subscription_plan && `${paid.subscription_plan} (${paid.subscription_billing_period ?? "—"})`],
      ["Amount Paid", paid.subscription_amount != null && money(paid.subscription_amount)],
      ["Payment Method", METHOD_LABELS[paid.payment_method]],
      ["Valid Until", paymentSuccess.validUntil ?? paid.subscription_end_date],
    ].filter(([, value]) => value);

    return (
      <Shell>
        <Hero icon="ok" title="Payment Successful">Your subscription is now active. You can start setting up your school right away.</Hero>
        <KeyValueList className={KV} items={rows.map(([label, value]) => ({ label, value }))} />
        <Btn variant="primary" block onClick={handleFinishPayment}>Go to Dashboard</Btn>
      </Shell>
    );
  }

  // Already active: show a plan summary + the option to switch or request a custom plan change
  if (status === "active") {
    const kind = user.pending_upgrade?.breakdown?.kind;
    return (
      <Page size="narrow">
        <PageHeader title="Subscription & Billing" sentence={<><strong className="font-semibold text-slate-800">{user.school_name}</strong> is fully active.</>}>
          <Btn href="/dean/dashboard">Back to Dashboard</Btn>
        </PageHeader>

        <Section title="Current plan">
          <KeyValueList
            className={KV}
            items={[
              { label: "Plan", value: user.subscription_plan },
              { label: "Billing", value: <span className="capitalize">{user.subscription_billing_period}</span> },
              { label: "Amount", value: money(user.subscription_amount) },
              ...(user.subscription_start_date ? [{ label: "Start Date", value: user.subscription_start_date }] : []),
              ...(user.subscription_end_date ? [{ label: "Valid Until", value: <Strong>{user.subscription_end_date}</Strong> }] : []),
            ]}
          />

          {user.scheduled_switch && (
            <div className="mt-4 space-y-3">
              <div className="k-note">
                <div className="min-w-0">
                  <p className="font-semibold">
                    Your switch to {user.scheduled_switch.plan} {user.scheduled_switch.billing_period} starts on {user.scheduled_switch.starts_on}.
                  </p>
                  <p className="mt-1">
                    You keep {user.subscription_plan} until then, and nothing is charged now. You will pay{" "}
                    {money(user.scheduled_switch.amount)} when the new term begins.
                  </p>
                </div>
              </div>
              <Btn sm onClick={handleCancelScheduledSwitch} disabled={switchBusy} className="max-sm:w-full">
                {switchBusy ? "Please wait…" : "Cancel scheduled switch"}
              </Btn>
            </div>
          )}

          {switchMessage && <div className="mt-4"><Banner tone="green">{switchMessage}</Banner></div>}
          {requestDone && <div className="mt-4"><Banner tone="blue">Request sent — the Super Admin will follow up with you.</Banner></div>}
          {error && <div className="mt-4"><Banner tone="red">{error}</Banner></div>}
        </Section>

        {user.pending_upgrade ? (
          <Section
            title={`${kind === "period_upgrade" ? `Switch to ${user.pending_upgrade.plan} yearly` : `Upgrade to ${user.pending_upgrade.plan}`} — Payment Pending`}
            help={
              kind === "period_upgrade"
                ? "Your monthly plan stays active. The yearly term starts once payment is confirmed."
                : `Basic features stay usable. ${user.pending_upgrade.plan} features unlock once payment is confirmed.`
            }
          >
            <div className="space-y-4">
              {user.pending_upgrade.payment_method === "bank_transfer" && user.pending_upgrade.payment_status === "pending_verification" && (
                <KeyValueList
            className={KV}
                  items={[
                    { label: "Reference", value: user.pending_upgrade.payment_reference },
                    { label: "Proof", value: <Pill tone="blue">Uploaded — awaiting Super Admin review</Pill> },
                  ]}
                />
              )}

              {user.pending_upgrade.payment_method === "bank_transfer" && user.pending_upgrade.payment_status === "pending" && (
                <>
                  <KeyValueList
            className={KV}
                    items={[
                      { label: "Bank", value: BANK_DETAILS.bankName },
                      { label: "Account Name", value: BANK_DETAILS.accountName },
                      { label: "Account Number", value: BANK_DETAILS.accountNumber },
                      { label: "Reference Code", value: user.pending_upgrade.payment_reference },
                      { label: "Amount", value: <Strong>{money(user.pending_upgrade.amount)}</Strong> },
                    ]}
                  />
                  <BillingBreakdown breakdown={user.pending_upgrade.breakdown} />
                  <form onSubmit={handleUploadProof} className="space-y-3 border-t border-slate-100 pt-4">
                    <FormField label="Upload Proof of Payment">
                      <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} className="k-input" />
                    </FormField>
                    <Btn type="submit" variant="primary" block disabled={busy}>{busy ? "Uploading…" : "Submit Proof of Payment"}</Btn>
                  </form>
                </>
              )}

              {user.pending_upgrade.payment_method !== "bank_transfer" && (
                <div className="space-y-3">
                  <p className="k-note is-warn">
                    We couldn&apos;t confirm your payment yet. This page confirms automatically if you finish paying in
                    that tab — but if you closed the payment window before completing it, pick up here instead.
                  </p>
                  <div className="flex flex-wrap gap-2 max-sm:flex-col">
                    <Btn variant="primary" sm onClick={() => handleCancelPendingUpgrade(true)} disabled={upgradeBusy}>
                      {upgradeBusy ? "Please wait…" : "Retry Payment"}
                    </Btn>
                    <Btn sm onClick={() => handleCancelPendingUpgrade(false)} disabled={upgradeBusy}>Cancel Upgrade</Btn>
                  </div>
                </div>
              )}

              {error && <Banner tone="red">{error}</Banner>}
            </div>
          </Section>
        ) : user.approved_change ? (
          <Section
            title="Approved — awaiting payment"
            help={
              <>
                The Super Admin approved your change to <strong>{user.approved_change.plan} ({user.approved_change.billing_period})</strong>.
                You keep {user.subscription_plan} until you pay.
              </>
            }
          >
            <div className="space-y-4">
              <BillingBreakdown breakdown={user.approved_change.breakdown} />
              {Number(user.approved_change.amount) > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Choose Payment Method</p>
                  <PaymentButtons onPick={handlePayApprovedChange} disabled={busy} />
                </div>
              ) : (
                <p className="k-note">Nothing to pay. The Super Admin will activate this plan for you.</p>
              )}
              {error && <Banner tone="red">{error}</Banner>}
              <Btn variant="ghost" sm onClick={handleCancelApprovedChange} disabled={busy}>Decline this change</Btn>
            </div>
          </Section>
        ) : upgradeFlow ? (
          <Section
            title={
              upgradeFlow.loading
                ? "Upgrade"
                : upgradeFlow.step === "confirm"
                  ? upgradeFlow.kind === "period_upgrade" ? "Switch to yearly" : `Upgrade to ${upgradeFlow.plan}`
                  : "Checkout"
            }
            help={
              !upgradeFlow.loading && upgradeFlow.step === "confirm"
                ? upgradeFlow.kind === "period_upgrade"
                  ? `Your ${upgradeFlow.plan} yearly term starts as soon as you pay and runs for 12 months. You get credit for the unused days of your monthly term.`
                  : "New features you will unlock:"
                : undefined
            }
          >
            {upgradeFlow.loading ? (
              <p className="text-sm text-slate-600" role="status">Calculating your prorated upgrade price…</p>
            ) : upgradeFlow.step === "confirm" ? (
              <div className="space-y-4">
                {upgradeFlow.kind !== "period_upgrade" && <FeatureList items={PLAN_FEATURES[upgradeFlow.plan]} />}
                {upgradeFlow.kind !== "period_upgrade" && (
                  <KeyValueList
            className={KV}
                    items={[
                      { label: `${user.subscription_plan} price`, value: `₱${upgradeFlow.quote.old_price.toLocaleString()}/${upgradeFlow.period === "monthly" ? "mo" : "yr"}` },
                      { label: `${upgradeFlow.plan} price`, value: `₱${upgradeFlow.quote.new_price.toLocaleString()}/${upgradeFlow.period === "monthly" ? "mo" : "yr"}` },
                      { label: "Remaining period", value: `${upgradeFlow.quote.remaining_days} of ${upgradeFlow.quote.total_days} days` },
                      { label: "Upgrade amount today", value: <Strong>₱{upgradeFlow.quote.amount_now.toLocaleString()}</Strong> },
                    ]}
                  />
                )}
                <BillingBreakdown breakdown={upgradeFlow.breakdown} />
                {upgradeFlow.kind === "period_upgrade" ? (
                  <p className="text-xs text-slate-600">
                    Your yearly term would run until about {upgradeFlow.quote.current_end_date}, then renews at ₱{upgradeFlow.quote.next_renewal_price.toLocaleString()}/yr. Your monthly term ends once the payment is confirmed.
                  </p>
                ) : (
                  <p className="text-xs text-slate-600">
                    Starting next renewal: ₱{upgradeFlow.quote.next_renewal_price.toLocaleString()}/{upgradeFlow.period === "monthly" ? "mo" : "yr"}. Your renewal date stays {upgradeFlow.quote.current_end_date}.
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
                  <Btn onClick={() => setUpgradeFlow(null)}>Cancel</Btn>
                  <Btn variant="primary" onClick={() => setUpgradeFlow((f) => ({ ...f, step: "payment" }))}>Continue to Payment</Btn>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <KeyValueList
            className={KV}
                  items={[
                    { label: upgradeFlow.kind === "period_upgrade" ? "Billing change" : "Plan Upgrade", value: upgradeFlow.kind === "period_upgrade" ? `${upgradeFlow.plan} monthly → yearly` : `${user.subscription_plan} → ${upgradeFlow.plan}` },
                    { label: "Amount Due Today", value: <Strong>₱{upgradeFlow.quote.amount_now.toLocaleString()}</Strong> },
                  ]}
                />
                <BillingBreakdown breakdown={upgradeFlow.breakdown} />
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Choose Payment Method</p>
                  <PaymentButtons onPick={handleUpgradePayment} disabled={upgradeBusy} />
                </div>
                {error && <Banner tone="red">{error}</Banner>}
                <Btn variant="ghost" sm onClick={() => setUpgradeFlow(null)}><NavIcon name="back" size={16} /> Back</Btn>
              </div>
            )}
          </Section>
        ) : (
          <Section
            title="Available Plans"
            help="Upgrades require payment and start now. A cheaper plan or shorter period starts when your current paid term ends."
          >
            <div className="k-seg mb-4 inline-flex" role="group" aria-label="Billing period">
              {["monthly", "yearly"].map((period) => (
                <button key={period} type="button" aria-pressed={billingToggle === period} onClick={() => setBillingToggle(period)} className="capitalize">
                  {period}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.keys(PLAN_PRICES).map((planName) => {
                const isCurrent = user.subscription_plan === planName && user.subscription_billing_period === billingToggle;
                const price = PLAN_PRICES[planName][billingToggle];
                const isUpgrade = price > Number(user.subscription_amount ?? 0);
                const samePeriodAsCurrent = billingToggle === user.subscription_billing_period;
                return (
                  <div key={planName} className={`flex min-w-0 flex-col rounded-xl border p-4 sm:p-5 ${isCurrent ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-base font-semibold text-slate-900">{planName}</p>
                      {isCurrent && <Pill tone="blue">Current Plan</Pill>}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                      ₱{price.toLocaleString()}
                      <span className="text-sm font-medium text-slate-600"> / {billingToggle === "monthly" ? "mo" : "yr"}</span>
                    </p>
                    <FeatureList items={PLAN_FEATURES[planName]} className="mt-4 flex-1" />

                    {!isCurrent && isUpgrade && samePeriodAsCurrent && (
                      <Btn variant="primary" block className="mt-5" onClick={() => handleOpenUpgrade(planName, billingToggle)}>
                        Upgrade to {planName}
                      </Btn>
                    )}
                    {!isCurrent && isUpgrade && !samePeriodAsCurrent && user.subscription_plan === planName && user.subscription_billing_period === "monthly" && billingToggle === "yearly" && (
                      <Btn variant="primary" block className="mt-5" onClick={() => handleOpenUpgrade(planName, "yearly")}>
                        Switch to yearly
                      </Btn>
                    )}
                    {!isCurrent && isUpgrade && !samePeriodAsCurrent && !(user.subscription_plan === planName && user.subscription_billing_period === "monthly" && billingToggle === "yearly") && (
                      <p className="mt-5 text-xs text-slate-600">Switch to your {user.subscription_billing_period} tab to upgrade.</p>
                    )}
                    {!isCurrent && !isUpgrade && (
                      <Btn block className="mt-5 whitespace-normal" onClick={() => handleSwitchPlan(planName, billingToggle)} disabled={switchBusy}>
                        {switchBusy ? "Scheduling…" : user.scheduled_switch?.plan === planName && user.scheduled_switch?.billing_period === billingToggle ? "Switch already scheduled" : `Switch to ${planName} at end of term`}
                      </Btn>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-center">
              <p className="text-xs text-slate-600">Upgrades and scheduled switches use the standard rate above — no discounts.</p>
              <Btn variant="ghost" sm className="whitespace-normal" aria-expanded={requestOpen} onClick={() => { setRequestOpen((v) => !v); setRequestDone(false); }}>
                Need a custom rate? Request a plan change <NavIcon name="arrow" size={14} />
              </Btn>
            </div>

            {requestOpen && (
              <form onSubmit={handleRequestChange} className="mt-4 space-y-4 border-t border-slate-100 pt-4 text-left">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Requested Plan">
                    <Select
                      required
                      value={requestPlan?.name ?? ""}
                      onChange={(e) => setRequestPlan((p) => ({ period: p?.period ?? "monthly", ...p, name: e.target.value }))}
                    >
                      <option value="" disabled>Select a plan</option>
                      <option value="Basic">Basic</option>
                      <option value="Premium">Premium</option>
                    </Select>
                  </FormField>
                  <FormField label="Billing Period">
                    <Select
                      required
                      value={requestPlan?.period ?? ""}
                      onChange={(e) => setRequestPlan((p) => ({ name: p?.name ?? "", ...p, period: e.target.value }))}
                    >
                      <option value="" disabled>Select a period</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </Select>
                  </FormField>
                </div>
                <FormField label="Message to Super Admin (optional)">
                  <Textarea
                    {...inputProps("note")}
                    rows={3}
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value)}
                    placeholder="e.g. Ask about a discount, a custom start date, or special terms"
                  />
                </FormField>
                <Btn type="submit" variant="primary" disabled={requestBusy} className="max-sm:w-full">{requestBusy ? "Sending…" : "Send Request"}</Btn>
              </form>
            )}
          </Section>
        )}
      </Page>
    );
  }

  // Offer sat unanswered/unpaid past its window
  if (status === "offer_expired") {
    return (
      <Shell>
        <Hero icon="alert" title="Subscription Offer Expired">
          Your subscription offer for <strong>{user.school_name}</strong> has expired. Please contact your Super Admin to request a new offer.
        </Hero>
        {offerRequested && <Banner tone="green">{offerRequested}</Banner>}
        {error && <Banner tone="red">{error}</Banner>}
        <div className="space-y-2">
          <Btn variant="primary" block onClick={handleRequestNewOffer} disabled={busy || Boolean(offerRequested)}>
            {busy ? "Sending…" : offerRequested ? "Request sent" : "Request a new offer"}
          </Btn>
          <a href="mailto:hello@internova.ai" className={btnClass("ghost", { block: true })}>Contact Super Admin</a>
        </div>
      </Shell>
    );
  }

  // Paid term ended: renew (same plan by default), then the normal checkout takes over
  if (status === "expired") {
    const plan = renewPlan || user.subscription_plan;
    const period = renewPeriod || user.subscription_billing_period;
    const price = PLAN_PRICES[plan]?.[period];
    return (
      <Shell>
        <Hero icon="alert" title="Subscription Expired">
          {user.school_name}&apos;s {user.subscription_plan} plan ended{user.subscription_end_date ? ` on ${user.subscription_end_date}` : ""}. Renew to keep using Internova. Your data is safe and nothing was deleted.
        </Hero>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Plan">
            <Select value={plan} onChange={(e) => setRenewPlan(e.target.value)}>
              {Object.keys(PLAN_PRICES).map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </FormField>
          <FormField label="Billing Period">
            <Select value={period} onChange={(e) => setRenewPeriod(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </FormField>
        </div>
        {price != null && plan === user.subscription_plan && period === user.subscription_billing_period ? (
          <p className="text-sm text-slate-600">Renewing the same plan keeps your last rate ({money(user.subscription_amount)}). You see the exact total before you pay.</p>
        ) : price != null ? (
          <p className="text-sm text-slate-600">{plan} {period} is {money(price)}. You see the exact total before you pay.</p>
        ) : null}
        {error && <Banner tone="red">{error}</Banner>}
        <div className="space-y-2">
          <Btn variant="primary" block onClick={handleRenew} disabled={busy}>{busy ? "Please wait…" : "Renew Subscription"}</Btn>
          <a href="mailto:hello@internova.ai" className={btnClass("ghost", { block: true })}>Contact Super Admin</a>
        </div>
      </Shell>
    );
  }

  // Waiting for Super Admin verification of an uploaded bank transfer proof
  if (status === "pending_payment" && user.payment_method === "bank_transfer" && user.payment_status === "pending_verification") {
    return (
      <Shell>
        <Hero icon="search" title="Payment Under Verification">Your proof was submitted successfully. The Super Admin will verify it shortly.</Hero>
        <KeyValueList
            className={KV}
          items={[
            { label: "Plan", value: user.subscription_plan },
            { label: "Payment Method", value: "Bank Transfer" },
            { label: "Reference", value: user.payment_reference },
            { label: "Proof", value: <Pill tone="blue">Uploaded</Pill> },
          ]}
        />
      </Shell>
    );
  }

  // Bank transfer chosen: show bank details + reference + upload form
  if (status === "pending_payment" && user.payment_method === "bank_transfer" && !changeMethod) {
    return (
      <Shell>
        <Hero icon="bank" title="Bank Transfer Details">Transfer the amount below, then upload your proof of payment.</Hero>

        <KeyValueList
            className={KV}
          items={[
            { label: "Bank", value: BANK_DETAILS.bankName },
            { label: "Account Name", value: BANK_DETAILS.accountName },
            { label: "Account Number", value: BANK_DETAILS.accountNumber },
            { label: "Reference Code", value: user.payment_reference },
            { label: "Amount", value: <Strong>{money(user.subscription_amount)}</Strong> },
          ]}
        />

        <form onSubmit={handleUploadProof} className="space-y-3 border-t border-slate-100 pt-5 text-left">
          <FormField label="Upload Proof of Payment">
            <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} className="k-input" />
          </FormField>
          {error && <Banner tone="red">{error}</Banner>}
          <Btn type="submit" variant="primary" block disabled={busy}>{busy ? "Uploading…" : "Submit Proof of Payment"}</Btn>
        </form>
        <Btn variant="ghost" block onClick={() => setChangeMethod(true)} disabled={busy}>Pay another way instead</Btn>
      </Shell>
    );
  }

  // Offer accepted (or a payment started but not finished): choose a payment method
  if (status === "accepted" || status === "pending_payment" || checkoutOpen) {
    return (
      <Shell>
        <Hero icon="card" title="Checkout" />
        <KeyValueList
            className={KV}
          items={[
            { label: "Plan", value: `${user.subscription_plan} — ${user.subscription_billing_period}` },
            { label: "Amount Due", value: <Strong>{money(user.subscription_amount)}</Strong> },
          ]}
        />

        <BillingBreakdown breakdown={user.subscription_breakdown} />

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">Choose Payment Method</p>
          <PaymentButtons onPick={handleChoosePayment} disabled={busy} />
        </div>

        {PAYMENT_TEST_MODE && (
          <p className="text-xs leading-relaxed text-slate-600">
            <strong>Test Mode</strong> — GCash, Maya, and Card go through PayMongo&apos;s sandbox checkout (no real money moves). Bank Transfer is fully functional and reviewed manually by the Super Admin.
          </p>
        )}

        {String(user.payment_reference ?? "").startsWith("cs_") && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-600">Already paid on PayMongo but this page did not update? Check your payment.</p>
            <Btn block onClick={() => confirmWithPayMongo(user)} disabled={busy}>I already paid — check my payment</Btn>
          </div>
        )}

        {error && <Banner tone="red">{error}</Banner>}
      </Shell>
    );
  }

  // Default: awaiting_acceptance — review the offer
  return (
    <Shell>
      <Hero icon="graduation" title="Welcome to Internova">
        Your subscription offer for <strong>{user.school_name}</strong> is ready.
      </Hero>

      <KeyValueList
            className={KV}
        items={[
          { label: "Plan", value: user.subscription_plan },
          { label: "Billing", value: <span className="capitalize">{user.subscription_billing_period}</span> },
          { label: "Amount Due", value: <Strong>{money(user.subscription_amount)}</Strong> },
        ]}
      />

      <BillingBreakdown breakdown={user.subscription_breakdown} />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Included Features</p>
        <FeatureList items={features} />
      </div>

      {error && <Banner tone="red">{error}</Banner>}

      <div className="space-y-2">
        <Btn variant="primary" block onClick={handleAccept} disabled={busy}>{busy ? "Processing…" : "Accept Plan & Proceed to Payment"}</Btn>
        <Btn href="/dean/preview" block>Preview {user.subscription_plan} Features</Btn>
        <a href="mailto:hello@internova.ai" className={btnClass("ghost", { block: true })}>Contact Super Admin</a>
      </div>
    </Shell>
  );
}
