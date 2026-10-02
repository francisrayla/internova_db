"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function AIUsagePage() {
  const [schools, setSchools] = useState([]);
  const [summary, setSummary] = useState({ entitled_schools: 0, polished_count: 0, drafted_count: 0, failed_count: 0, feature_live: false, model: null, period_label: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuperadminData("ai-usage")
      .then((r) => {
        setSchools(r.schools ?? []);
        setSummary({
          entitled_schools: r.entitled_schools ?? 0,
          polished_count: r.polished_count ?? 0,
          drafted_count: r.drafted_count ?? 0,
          failed_count: r.failed_count ?? 0,
          feature_live: Boolean(r.feature_live),
          model: r.model ?? null,
          period_label: r.period_label ?? "",
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">AI Usage</h2>
        <p className="mt-1 text-sm text-slate-600">
          AI writing help for intern narratives — polishing what interns write, and drafting entries for days they
          attended but didn&apos;t log. Included in the Premium plan.
        </p>
      </div>

      {!loading && (summary.feature_live ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">AI is live</p>
            <p className="mt-0.5 text-sm text-emerald-700">
              Running on Google Gemini ({summary.model}). If the AI is ever unavailable, interns can still save their narratives as written.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-800">AI isn&apos;t set up on the server</p>
            <p className="mt-0.5 text-sm text-amber-700">
              Add a GEMINI_API_KEY to the backend and queue services to turn it on. Until then, interns save narratives as written
              and missed days get a plain template entry.
            </p>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ["Entitled schools", summary.entitled_schools, "On a plan that includes AI"],
          ["Narratives polished", summary.polished_count, summary.period_label || "This month"],
          ["Narratives auto-drafted", summary.drafted_count, summary.period_label || "This month"],
          ["Failed requests", summary.failed_count, "Fell back to saving as written"],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{loading ? "—" : value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : schools.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">No schools yet.</p>
        ) : (
          <>
            <div className="divide-y divide-slate-100 sm:hidden">
              {schools.map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-medium text-slate-900">{s.school_name}</p>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        s.ai_entitled ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {s.ai_entitled ? "Included" : "Not on plan"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{s.plan ?? "—"}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {s.polished_count} polished · {s.drafted_count} auto-drafted this month
                  </p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["School", "Plan", "AI Entitlement", "Polished", "Auto-drafted"].map((h) => (
                      <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {schools.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">{s.school_name}</td>
                      <td className="px-6 py-4 text-slate-600">{s.plan ?? "—"}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            s.ai_entitled ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {s.ai_entitled ? "Included in plan" : "Not on this plan"}
                        </span>
                      </td>
                      <td className="px-6 py-4 tabular-nums text-slate-600">{s.polished_count}</td>
                      <td className="px-6 py-4 tabular-nums text-slate-600">{s.drafted_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
