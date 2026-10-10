"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { apiFetch } from "@/lib/apiFetch";
import { clampOnBlur } from "@/lib/clampNumber";

import { inputProps, cleanNumber } from "@/lib/inputRules";
import { CORE_FEATURES, CORE_LABELS, OPTIONAL_FEATURES } from "@/lib/planCatalog";
import { Check } from "lucide-react";
import { Btn, EmptyState, FormField, Input, KeyValueList, Page, PageHeader, Pill, Section, SheetFrame, SkeletonList, Textarea } from "@/components/dash/page";
import SaToast, { useSaToast } from "../SaToast";
function peso(amount) {
  return "₱" + Number(amount ?? 0).toLocaleString();
}

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, showToast] = useSaToast();
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const echoChannelRef = useRef(null);

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
    echoChannelRef.current = echo.private("superadmin.notifications").listen(".notification.created", handlePush);

    return () => {
      echo.private("superadmin.notifications").stopListening(".notification.created", handlePush);
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
      features: [...new Set([...CORE_LABELS, ...(plan.features ?? [])])],
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
    <Page>
      <SaToast msg={toast} />

      <PageHeader
        title="Subscription Plans"
        sentence="Editing a plan changes what schools pay on their next purchase or upgrade — active subscriptions keep the rate they already locked in."
        meta={lastLiveUpdate ? `Live: updated ${lastLiveUpdate.toLocaleTimeString()}` : undefined}
      />

      {loading ? (
        <SkeletonList rows={2} height="h-48" />
      ) : plans.length === 0 ? (
        <Section>
          <EmptyState icon="plans" title="No plans yet" text="Plans appear here once they are set up on the server." />
        </Section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:gap-6">
          {plans.map((plan) => (
            <Section
              key={plan.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {plan.name}
                  <Pill tone={plan.is_active ? "green" : "slate"}>{plan.is_active ? "Available" : "Hidden"}</Pill>
                </span>
              }
              help={plan.description || undefined}
              action={<Btn sm className="shrink-0" onClick={() => openEdit(plan)} aria-label={`Edit ${plan.name} plan`}>Edit Plan</Btn>}
            >
              <KeyValueList
                items={[
                  { label: "Per month", value: peso(plan.monthly_price) },
                  { label: "Per year", value: peso(plan.yearly_price) },
                  { label: "Schools on this plan", value: `${plan.active_schools} active` },
                ]}
              />
              <h3 className="mt-5 text-sm font-semibold" style={{ color: "var(--ui-ink)" }}>Features included</h3>
              <ul className="mt-2 grid gap-2 text-sm" style={{ color: "var(--ui-muted)" }}>
                {(plan.features ?? []).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--ui-ok)" }} />
                    <span className="min-w-0 break-words">{f}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}

      {editing && (
        <SheetFrame
          title={`Edit ${editing.name}`}
          size="md"
          onClose={() => !saving && setEditing(null)}
          footer={
            <>
              <Btn onClick={() => setEditing(null)} disabled={saving}>Cancel</Btn>
              <Btn variant="primary" onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save Plan"}</Btn>
            </>
          }
        >
          <div className="grid gap-4">
            <FormField label="Description">
              <Textarea
                {...inputProps("note")}
                value={editing.description}
                onChange={(e) => setEditing((ed) => ({ ...ed, description: e.target.value }))}
                rows={2}
              />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Monthly price (₱)">
                <Input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={editing.monthly_price}
                  onChange={(e) => setEditing((ed) => ({ ...ed, monthly_price: cleanNumber(e.target.value, { max: 1000000, decimals: 2 }) }))}
                  onBlur={(e) => setEditing((ed) => ({ ...ed, monthly_price: clampOnBlur(e.target.value, 0, 1000000) }))}
                />
              </FormField>
              <FormField label="Yearly price (₱)">
                <Input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={editing.yearly_price}
                  onChange={(e) => setEditing((ed) => ({ ...ed, yearly_price: cleanNumber(e.target.value, { max: 10000000, decimals: 2, maxDigits: 8 }) }))}
                  onBlur={(e) => setEditing((ed) => ({ ...ed, yearly_price: clampOnBlur(e.target.value, 0, 10000000) }))}
                />
              </FormField>
            </div>

            <div>
              <p className="k-label mb-2">Included in every plan</p>
              <ul className="grid gap-2 rounded-xl p-3" style={{ background: "var(--ui-soft)" }}>
                {CORE_FEATURES.map((f) => (
                  <li key={f.label} className="flex items-start gap-2 text-sm" style={{ color: "var(--ui-ink)" }}>
                    <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--ui-ok)" }} />
                    <span className="min-w-0">
                      {f.label}
                      <span className="block text-xs" style={{ color: "var(--ui-muted)" }}>{f.hint}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="k-label mb-1">Optional features: tick what this plan includes</p>
              <div className="grid gap-1">
                {OPTIONAL_FEATURES.map((f) => (
                  <label key={f.label} className="k-check">
                    <input
                      type="checkbox"
                      checked={editing.features.includes(f.label)}
                      onChange={() => toggleFeature(f.label)}
                    />
                    <span className="min-w-0">
                      {f.label}
                      <span className="block text-xs" style={{ color: "var(--ui-muted)" }}>{f.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="k-check justify-between rounded-xl border px-3" style={{ borderColor: "var(--ui-line)" }}>
              <span>Available for new signups / switches</span>
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(e) => setEditing((ed) => ({ ...ed, is_active: e.target.checked }))}
              />
            </label>
          </div>
        </SheetFrame>
      )}
    </Page>
  );
}
