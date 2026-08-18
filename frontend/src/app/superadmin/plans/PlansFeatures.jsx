"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";

// Canonical feature catalog — the checkboxes in the Edit modal are built from
// this list, but a plan's actual entitlements are whatever's saved in its
// `features` column, not this list itself.
const ALL_FEATURES = [
  "GPS + Selfie Attendance",
  "Parent Task Management",
  "Pending / Ongoing / Done tracking",
  "Basic Monitoring",
  "Subtasks",
  "Attachments",
  "Task Comments",
  "Real-time Chat",
  "Per-task Rating + Comments",
  "Formal Evaluations",
  "AI Portfolio / Reports",
];

function peso(amount) {
  return "₱" + Number(amount ?? 0).toLocaleString();
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const echoChannelRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function load() {
    setLoading(true);
    fetchSuperadminData("plans-features")
      .then((r) => setPlans(r.plans ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  // Another Super Admin tab editing a plan, or a school's active-subscriber
  // count changing, should reflect here without a manual refresh.
  useEffect(() => {
    const echo = getEcho();
    if (!echo) return;

    function handlePush() {
      setLastLiveUpdate(new Date());
      load();
    }

    // NotificationBell and the Schools/Billing screens share this same public
    // channel — echo.leave() would tear it down for all of them, so this
    // only unbinds this component's own listener on cleanup.
    echoChannelRef.current = echo.channel("superadmin-notifications").listen(".notification.created", handlePush);

    return () => {
      echo.channel("superadmin-notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
  }, []);

  function openEdit(plan) {
    setEditing({
      id: plan.id,
      name: plan.name,
      description: plan.description ?? "",
      monthly_price: String(plan.monthly_price ?? 0),
      yearly_price: String(plan.yearly_price ?? 0),
      features: [...(plan.features ?? [])],
      is_active: Boolean(plan.is_active),
    });
  }

  function toggleFeature(feat) {
    setEditing((e) => ({
      ...e,
      features: e.features.includes(feat) ? e.features.filter((f) => f !== feat) : [...e.features, feat],
    }));
  }

  async function saveEdit() {
    if (!editing.features.length) {
      showToast("Select at least one feature.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/superadmin/plans/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editing.description,
          monthly_price: Number(editing.monthly_price),
          yearly_price: Number(editing.yearly_price),
          features: editing.features,
          is_active: editing.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to save plan.");

      setPlans((prev) => prev.map((p) => (p.id === data.plan.id ? data.plan : p)));
      setEditing(null);
      showToast(data.message || "Plan saved.");
    } catch (err) {
      showToast(err.message || "Failed to save plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Subscription Plans</h2>
          <p className="mt-1 text-sm text-slate-600">
            Editing a plan changes what schools pay on their <span className="font-medium">next</span> purchase or
            upgrade — active subscriptions keep the rate they already locked in.
          </p>
        </div>
        {lastLiveUpdate && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            Live — updated {lastLiveUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Loading plans…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        plan.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {plan.is_active ? "Available" : "Hidden"}
                    </span>
                  </div>
                  {plan.description && <p className="mt-1 text-sm text-slate-500">{plan.description}</p>}
                  <div className="mt-3 flex items-baseline gap-4">
                    <div>
                      <span className="text-2xl font-semibold text-blue-700">{peso(plan.monthly_price)}</span>
                      <span className="ml-1 text-sm text-slate-500">/month</span>
                    </div>
                    <div>
                      <span className="text-lg font-semibold text-slate-700">{peso(plan.yearly_price)}</span>
                      <span className="ml-1 text-sm text-slate-500">/year</span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-medium text-slate-400">
                    {plan.active_schools} active school{plan.active_schools === 1 ? "" : "s"} on this plan
                  </p>
                </div>
                <button
                  onClick={() => openEdit(plan)}
                  className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit Plan
                </button>
              </div>
              <div className="mt-6">
                <h4 className="font-semibold text-slate-900">Features included:</h4>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {(plan.features ?? []).map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => !saving && setEditing(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
              <textarea
                value={editing.description}
                onChange={(e) => setEditing((ed) => ({ ...ed, description: e.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Monthly price (₱)</label>
                <input
                  type="number"
                  min="0"
                  value={editing.monthly_price}
                  onChange={(e) => setEditing((ed) => ({ ...ed, monthly_price: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Yearly price (₱)</label>
                <input
                  type="number"
                  min="0"
                  value={editing.yearly_price}
                  onChange={(e) => setEditing((ed) => ({ ...ed, yearly_price: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-600">Features</p>
              <div className="space-y-2">
                {ALL_FEATURES.map((feat) => (
                  <label key={feat} className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={editing.features.includes(feat)}
                      onChange={() => toggleFeature(feat)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span className="text-sm text-slate-700">{feat}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <span className="text-sm text-slate-700">Available for new signups / switches</span>
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(e) => setEditing((ed) => ({ ...ed, is_active: e.target.checked }))}
                className="h-4 w-4 accent-blue-600"
              />
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Plan"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
