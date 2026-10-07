"use client";

import { peso } from "@/lib/format";

/**
 * "What you pay and why". Renders the server's breakdown (SubscriptionBreakdown.php) as-is,
 * so the total shown is exactly the amount that gets charged.
 */
export default function BillingBreakdown({ breakdown, title = "Price breakdown", className = "" }) {
  if (!breakdown?.lines?.length) return null;

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-2 space-y-2">
        {breakdown.lines.map((line) => (
          <li key={line.key}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words text-slate-600">{line.label}</span>
              <span className={`shrink-0 font-semibold ${line.amount < 0 ? "text-emerald-600" : "text-slate-900"}`}>
                {line.amount < 0 ? "− " : ""}{peso(Math.abs(line.amount))}
              </span>
            </div>
            {line.note && <p className="mt-0.5 break-words text-xs text-slate-500">{line.key === "discount" ? `Reason: ${line.note}` : line.note}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
        <span className="font-semibold text-slate-700">Total to pay</span>
        <span className="text-base font-bold text-blue-700">{peso(breakdown.total)}</span>
      </div>
    </div>
  );
}
