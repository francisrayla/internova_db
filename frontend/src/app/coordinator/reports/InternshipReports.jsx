"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

import { inputProps } from "@/lib/inputRules";
export default function InternshipReports() {
  const [interns, setInterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchCoordinatorData("interns")
      .then((r) => setInterns(r.interns ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = interns.filter((i) =>
    !query ||
    i.intern_name?.toLowerCase().includes(query.toLowerCase()) ||
    i.company_name?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Internship Reports</h2>
        <p className="mt-1 text-sm text-slate-600">Generate a formal, printable progress report for any intern — hours rendered, task standing, and every evaluation on file.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <input {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by intern or company…"
          className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
        />
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading interns…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {interns.length === 0 ? "No interns have been deployed yet." : "No interns match this search."}
          </p>
        ) : (
          filtered.map((i) => (
            <div key={i.deployment_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{i.intern_name}</p>
                <p className="text-xs text-slate-500">{i.company_name ?? "—"} · {i.hours_completed}h / {i.required_hours}h</p>
              </div>
              <Link
                href={`/coordinator/interns/${i.deployment_id}/report`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                View report →
              </Link>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
