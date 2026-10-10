"use client";

import { useState } from "react";
import { Card, Notice, Skel, StatusChip } from "@/components/dash";
import { peso } from "@/lib/format";

const STATUS_TONE = { active: "ok", superseded: undefined, scheduled: "info", expired: "risk", cancelled: undefined };

function label(value) {
  return (value ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Revenue figures come from the server (/api/superadmin/revenue), based on money actually paid. */
export default function RevenuePanel({ revenue, loading }) {
  const [open, setOpen] = useState(false);

  if (loading) return <Skel height={170} />;

  if (!revenue) return <Notice tone="warn">Revenue figures could not be loaded right now.</Notice>;

  const rows = revenue.breakdown ?? [];
  const subs = revenue.active_subscriptions;

  return (
    <Card
      title="Money"
      action={
        <button type="button" className="dash-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide breakdown" : "View breakdown"}
        </button>
      }
    >
      <div className="dash-money">
        <div className="min-w-0">
          <p className="dash-note">Collected this month</p>
          <p className="dash-huge">{peso(revenue.collected_this_month)}</p>
          <p className="dash-note" style={{ marginTop: 8 }}>
            Money paid in {revenue.this_month_label}. Last month: {peso(revenue.collected_last_month)}.
          </p>
        </div>
        <dl className="dash-facts dash-money-side">
          <div>
            <dt>Total collected</dt>
            <dd>{peso(revenue.total_collected)}</dd>
          </div>
          <div>
            <dt>Recurring each month</dt>
            <dd>{peso(revenue.recurring_monthly)}</dd>
          </div>
          <div>
            <dt>Active subscriptions</dt>
            <dd>{subs}</dd>
          </div>
        </dl>
      </div>
      <p className="dash-note" style={{ marginTop: 14, fontSize: "0.8125rem" }}>
        Total collected counts every confirmed payment. Recurring counts yearly plans as one twelfth per month.
      </p>

      {open && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--d-line)" }}>
          <p className="dash-note" style={{ marginBottom: 6 }}>What each school paid, after any discount.</p>
          {rows.length === 0 ? (
            <p className="dash-empty">No payments yet. Paid subscriptions will appear here.</p>
          ) : (
            <ul className="dash-list dash-wrap">
              {rows.map((r) => (
                <li key={r.subscription_id}>
                  <div className="dash-row" style={{ alignItems: "flex-start" }}>
                    <span className="dash-row-main">
                      <span className="dash-row-title">{r.school ?? "—"}</span>
                      <span className="dash-row-sub">{r.plan ?? "—"} · {label(r.billing_period)}</span>
                      <span className="dash-row-sub">
                        List {peso(r.list_price)} · Discount {r.discount > 0 ? `− ${peso(r.discount)}` : "none"} · Paid {r.recorded ? peso(r.amount_paid) : "not recorded"} · {label(r.method) || "No method"}
                      </span>
                      <span className="dash-row-sub">
                        {r.paid_at ? `Paid ${r.paid_at}` : "No payment date"}
                        {!r.recorded && " · No payment was collected for this plan change, so it is not counted."}
                      </span>
                    </span>
                    <StatusChip tone={STATUS_TONE[r.status]}>{label(r.status)}</StatusChip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
