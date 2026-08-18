"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function AIPage() {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetchSuperadminData("ai-controls");
        setFeatures(response.aiFeatures ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-600">Loading AI controls…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {features.map((feature, idx) => (
          <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-semibold text-slate-900">{feature.name}</p>
            <p className="mt-2 text-sm text-slate-600">{feature.description}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${feature.enabled ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"}`}>
                {feature.enabled ? "Active" : "Inactive"}
              </span>
              {feature.frequency && <span className="text-xs text-slate-500">{feature.frequency}</span>}
              {feature.confidence && <span className="text-xs text-slate-500">{feature.confidence}</span>}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">AI System Status</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600">Status</p>
            <p className="mt-2 text-lg font-semibold text-blue-700">All systems operational</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600">Processing capacity</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">87% utilized</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600">Last update</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">Today</p>
          </div>
        </div>
      </section>
    </div>
  );
}
