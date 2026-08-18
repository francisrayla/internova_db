"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function ReportsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetchSuperadminData("reports");
        setData(response);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-600">Loading reports…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        {data?.platformPerformance && (
          <button className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md">
            <p className="text-sm font-semibold text-slate-600">Platform performance</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{data.platformPerformance.uptime}</p>
            <p className="mt-1 text-sm text-blue-700">uptime</p>
          </button>
        )}
        {data?.userAdoption && (
          <button className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md">
            <p className="text-sm font-semibold text-slate-600">User adoption</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{data.userAdoption.activeAccounts}</p>
            <p className="mt-1 text-sm text-blue-700">active accounts</p>
          </button>
        )}
        {data?.revenueSnapshot && (
          <button className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md">
            <p className="text-sm font-semibold text-slate-600">Revenue snapshot</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{data.revenueSnapshot.monthly}</p>
            <p className="mt-1 text-sm text-blue-700">monthly</p>
          </button>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Preview</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">Platform performance</h3>
          </div>
          <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Export report</button>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          This report would summarize attendance, task completion, evaluation scores, company activity, and AI-assisted summaries for the selected organization or date range.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {data?.reports?.map((report, idx) => (
          <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="font-semibold text-slate-900">{report.name}</p>
            <p className="mt-2 text-sm text-slate-600">{report.description}</p>
            <p className="mt-3 text-xs font-semibold text-blue-700">{report.dataPoints} data points</p>
          </div>
        ))}
      </section>
    </div>
  );
}
