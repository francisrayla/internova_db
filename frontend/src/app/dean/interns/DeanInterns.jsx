"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import InternCard from "@/components/dean/InternCard";
import InternTable from "@/components/dean/InternTable";
import DownloadDocxButton from "@/components/narrative-report/DownloadDocxButton";
import { GROUPS, GROUP_ORDER } from "@/components/dean/monitoring";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

const VIEW_KEY = "dean.internsView";

function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

const STRIP_STYLE = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
};

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
  const [group, setGroup] = useState(GROUP_ORDER.includes(params.get("group")) ? params.get("group") : "");
  // Only used once the list has loaded (the toggle and table are not rendered before), so reading localStorage here cannot cause a hydration mismatch.
  const [view, setView] = useState(readView);
  const [downloadError, setDownloadError] = useState("");

  function chooseView(next) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just is not remembered.
    }
  }
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
    if (group) query.set("group", group);
    fetchApiData("dean", `interns?${query}`).then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, [debounced, status, companyId, attention, group]);

  useEffect(load, [load]);

  const filtering = Boolean(debounced || status || companyId || attention || group);

  return (
    <div className="space-y-5 sm:p-2 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Interns</h1>
        <p className="mt-1 text-slate-600">Every intern in your school, read-only. At risk interns are listed first. Tap one to see their attendance, journal, tasks, documents and narrative report.</p>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" role="group" aria-label="Filter by status group">
          {GROUP_ORDER.map((key) => {
            const g = GROUPS[key];
            const on = group === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setGroup(on ? "" : key)}
                className={`min-w-0 rounded-2xl border px-3 py-3 text-left transition ${STRIP_STYLE[g.tone]} ${on ? "ring-2 ring-blue-500" : "hover:shadow-sm"}`}
              >
                <span className="block text-2xl font-bold">{data.summary[key]}</span>
                <span className="block truncate text-sm font-semibold">{g.label}</span>
                <span className="hidden truncate text-xs opacity-80 sm:block">{g.help}</span>
              </button>
            );
          })}
        </div>
      )}

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
          Has a flag
        </button>
        <DownloadDocxButton
          docxUrl="/api/dean/report/docx"
          label="Download school report (.docx)"
          fallbackName="School_Monitoring_Report.docx"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:ml-auto"
          onError={setDownloadError}
        />
      </div>
      {downloadError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{downloadError}</p>}

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
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">{data.interns.length} {data.interns.length === 1 ? "intern" : "interns"}</p>
            <div className="hidden gap-1 rounded-xl bg-slate-100 p-1 lg:flex" role="group" aria-label="Choose how to show interns">
              {[["cards", "Cards"], ["table", "Table"]].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => chooseView(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === "table" && (
            <div className="hidden min-w-0 lg:block">
              <InternTable interns={data.interns} />
            </div>
          )}
          <div className={`grid grid-cols-1 gap-3 lg:grid-cols-2 ${view === "table" ? "lg:hidden" : ""}`}>
            {data.interns.map((i) => <InternCard key={i.deployment_id} intern={i} />)}
          </div>
        </>
      )}
    </div>
  );
}
