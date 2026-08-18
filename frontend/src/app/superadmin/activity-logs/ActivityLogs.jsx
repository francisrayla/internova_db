"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

const MODULE_COLORS = {
  Schools: "bg-blue-100 text-blue-700",
  Payment: "bg-emerald-100 text-emerald-700",
  Subscription: "bg-purple-100 text-purple-700",
  Plans: "bg-amber-100 text-amber-700",
  Inquiries: "bg-cyan-100 text-cyan-700",
};

function moduleColor(module) {
  return MODULE_COLORS[module] ?? "bg-slate-100 text-slate-700";
}

function toCsv(rows) {
  const header = ["Date/Time", "User", "School", "Module", "Action", "Details"];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(",")];
  rows.forEach((l) => {
    lines.push([l.timestamp, l.user, l.school ?? "—", l.module, l.action, l.description ?? ""].map(escape).join(","));
  });
  return lines.join("\n");
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState([]);
  const [modules, setModules] = useState([]);
  const [moduleFilter, setModuleFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (moduleFilter !== "All") params.set("module", moduleFilter);

    fetchSuperadminData(`activity-logs?${params.toString()}`)
      .then((r) => {
        setLogs(r.logs ?? []);
        setModules(r.modules ?? []);
        setTotal(r.total ?? 0);
        setHasMore(Boolean(r.has_more));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, moduleFilter]);

  function handleModuleChange(value) {
    setModuleFilter(value);
    setPage(1);
  }

  function handleExport() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-log-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(query.toLowerCase()) ||
      (l.school ?? "").toLowerCase().includes(query.toLowerCase()) ||
      l.module.toLowerCase().includes(query.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Activity Logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          A running record of platform actions — payments, approvals, and account changes — as they happen.
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this page by action, school, or module…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={moduleFilter}
            onChange={(e) => handleModuleChange(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="All">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="ml-auto rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Export this page (CSV)
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading logs…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {total === 0 ? "No activity recorded yet." : "No logs match this page's filters."}
          </p>
        ) : (
          filtered.map((log) => (
            <div key={log.id} className="border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${moduleColor(log.module)}`}>{log.module}</span>
                    <p className="font-medium text-slate-900">{log.action}</p>
                  </div>
                  {log.description && <p className="mt-1 text-sm text-slate-500">{log.description}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">
                    {log.user}{log.school ? ` · ${log.school}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{log.timestamp}</span>
              </div>
            </div>
          ))
        )}
      </section>

      {total > 25 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">Page {page} of {totalPages} · {total} total</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
