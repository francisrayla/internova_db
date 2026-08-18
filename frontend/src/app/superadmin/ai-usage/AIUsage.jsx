"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function AIUsagePage() {
  const [schools, setSchools] = useState([]);
  const [summary, setSummary] = useState({ entitled_schools: 0, total_reports: 0, total_portfolios: 0, feature_live: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuperadminData("ai-usage")
      .then((r) => {
        setSchools(r.schools ?? []);
        setSummary({
          entitled_schools: r.entitled_schools ?? 0,
          total_reports: r.total_reports ?? 0,
          total_portfolios: r.total_portfolios ?? 0,
          feature_live: Boolean(r.feature_live),
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
          AI-assisted portfolio and report generation, per the Premium plan entitlement.
        </p>
      </div>

      {!summary.feature_live && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <span className="mt-0.5 text-lg">🚧</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">AI generation isn&apos;t live yet</p>
            <p className="mt-0.5 text-sm text-amber-700">
              Report and portfolio generation hasn&apos;t been connected to a generation service yet, so usage is
              genuinely zero platform-wide. What&apos;s shown below is real: which schools are entitled to the
              feature under their current plan, ready to track real usage once generation goes live.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Entitled Schools</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.entitled_schools}</p>
          <p className="mt-1 text-xs text-slate-500">On a plan that includes AI features</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports Generated</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.total_reports}</p>
          <p className="mt-1 text-xs text-slate-500">Platform-wide, all time</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portfolios Generated</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.total_portfolios}</p>
          <p className="mt-1 text-xs text-slate-500">Platform-wide, all time</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["School", "Plan", "AI Entitlement", "Reports Generated", "Portfolios Generated"].map((h) => (
                <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-500">Loading…</td></tr>
            ) : schools.length === 0 ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-500">No schools yet.</td></tr>
            ) : (
              schools.map((s) => (
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
                  <td className="px-6 py-4 text-slate-500">{s.reports_generated}</td>
                  <td className="px-6 py-4 text-slate-500">{s.portfolios_generated}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
