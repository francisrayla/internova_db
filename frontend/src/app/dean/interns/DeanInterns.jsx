"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import InternCard from "@/components/dean/InternCard";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];

const fieldClass = "rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

export default function DeanInterns() {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [attention, setAttention] = useState(params.get("filter") === "attention");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    const query = new URLSearchParams();
    if (debounced) query.set("search", debounced);
    if (status) query.set("status", status);
    if (companyId) query.set("company_id", companyId);
    if (attention) query.set("attention", "1");
    fetchApiData("dean", `interns?${query}`).then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, [debounced, status, companyId, attention]);

  useEffect(load, [load]);

  const filtering = Boolean(debounced || status || companyId || attention);

  return (
    <div className="space-y-5 sm:p-2 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Interns</h1>
        <p className="mt-1 text-slate-600">Every intern in your school, read-only. Tap a card to see their attendance, journal, tasks, documents and narrative report.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or student number" aria-label="Search interns" className={`${fieldClass} w-full sm:w-72`} />
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${status === f.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {data?.companies?.length > 1 && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Filter by company" className={fieldClass}>
            <option value="">All companies</option>
            {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button
          type="button"
          aria-pressed={attention}
          onClick={() => setAttention((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-sm font-semibold ${attention ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
        >
          Needs attention
        </button>
      </div>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your interns.</ErrorNote>}
      {!data && !error && <SkeletonList rows={4} height="h-32" />}

      {data && data.interns.length === 0 && (
        filtering ? (
          <EmptyState icon="users" title="No interns match" text="Try a different name or clear a filter." />
        ) : (
          <EmptyState icon="users" title="No interns yet" text="Once your coordinator adds interns and deploys them to partner companies, they will show up here with their progress." />
        )
      )}

      {data && data.interns.length > 0 && (
        <>
          <p className="text-sm text-slate-500">{data.interns.length} {data.interns.length === 1 ? "intern" : "interns"}</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.interns.map((i) => <InternCard key={i.deployment_id} intern={i} />)}
          </div>
        </>
      )}
    </div>
  );
}
