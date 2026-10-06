"use client";

import { useState } from "react";
import { EmptyState, Pill, SectionTitle, Skeleton } from "@/components/ui";

const peso = (n) => `₱${Number(n ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

const STATUS_TONE = { active: "green", superseded: "slate", scheduled: "blue", expired: "red", cancelled: "slate" };

function label(value) {
  return (value ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MoneyCard({ title, value, note, primary }) {
  return (
    <div className={`min-w-0 rounded-2xl border p-5 shadow-sm ${primary ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-3 break-words text-2xl font-bold text-slate-900 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

/** Revenue figures come from the server (/api/superadmin/revenue), based on money actually paid. */
export default function RevenuePanel({ revenue, loading }) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <section className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}
      </section>
    );
  }

  if (!revenue) {
    return (
      <section className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Revenue figures could not be loaded right now.
      </section>
    );
  }

  const rows = revenue.breakdown ?? [];

  return (
    <section className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyCard
          primary
          title="Collected this month"
          value={peso(revenue.collected_this_month)}
          note={`Money paid in ${revenue.this_month_label}. Last month: ${peso(revenue.collected_last_month)}`}
        />
        <MoneyCard
          title="Total collected"
          value={peso(revenue.total_collected)}
          note="All confirmed payments since the start"
        />
        <MoneyCard
          title="Recurring (monthly equivalent)"
          value={peso(revenue.recurring_monthly)}
          note={`Yearly plans counted as 1/12 per month · ${revenue.active_subscriptions} active subscription${revenue.active_subscriptions === 1 ? "" : "s"}`}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-sm font-semibold text-blue-600 hover:underline"
        >
          {open ? "Hide breakdown" : "View breakdown"}
        </button>
      </div>

      {open && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <SectionTitle title="Payments by school" help="What each school paid, after any discount. Paid amount is the money actually collected." />
          {rows.length === 0 ? (
            <EmptyState icon="check" title="No payments yet" text="Paid subscriptions will appear here." />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.subscription_id} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-slate-900">{r.school ?? "—"}</p>
                      <p className="text-xs text-slate-500">{r.plan ?? "—"} · {label(r.billing_period)}</p>
                    </div>
                    <Pill tone={STATUS_TONE[r.status] ?? "slate"} size="sm">{label(r.status)}</Pill>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-slate-500">List price</dt><dd className="font-medium text-slate-800">{peso(r.list_price)}</dd></div>
                    <div><dt className="text-slate-500">Discount</dt><dd className="font-medium text-slate-800">{r.discount > 0 ? `− ${peso(r.discount)}` : "None"}</dd></div>
                    <div><dt className="text-slate-500">Paid</dt><dd className="font-semibold text-slate-900">{r.recorded ? peso(r.amount_paid) : "Not recorded"}</dd></div>
                    <div><dt className="text-slate-500">Method</dt><dd className="font-medium text-slate-800">{label(r.method) || "—"}</dd></div>
                  </dl>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    {r.paid_at ? `Paid ${r.paid_at}` : "No payment date"}
                    {!r.recorded && " · No payment was collected for this plan change, so it is not counted."}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
