"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import Icon from "@/components/Icon";

import { inputProps } from "@/lib/inputRules";
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

function LogCard({ log }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${moduleColor(log.module)}`}>{log.module}</span>
            <p className="font-medium text-slate-900">{log.action}</p>
          </div>
          {log.description && <p className="mt-1 text-sm text-slate-500">{log.description}</p>}
          <p className="mt-1.5 text-xs text-slate-400">{log.user}</p>
        </div>
        <span className="shrink-0 text-xs text-slate-400">{log.timestamp}</span>
      </div>
    </div>
  );
}

/**
 * One school's own slice of the feed — collapsed by default and completely
 * unfetched until the superadmin clicks it open, so landing on this screen
 * never means downloading (or scrolling through) every school's history at
 * once. Fetches and paginates independently of every other section (see
 * SuperadminFullController::activityLogs, scoped by school_id) so a school
 * with dozens of entries never buries the others. Remounts (via the `key`
 * the parent gives it) whenever the module filter changes, which naturally
 * collapses it again — filtering fresh data means re-opening it.
 */
function SchoolSection({ schoolId, name, total, moduleFilter, query, onLogsChange }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  function fetchFirstPage() {
    setLoading(true);
    const params = new URLSearchParams({ page: "1", school_id: schoolId ?? "none" });
    if (moduleFilter !== "All") params.set("module", moduleFilter);
    fetchSuperadminData(`activity-logs?${params.toString()}`)
      .then((r) => {
        const next = r.logs ?? [];
        setLogs(next);
        onLogsChange(next);
        setHasMore(Boolean(r.has_more));
        setPage(1);
        setLoaded(true);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) fetchFirstPage();
  }

  function loadMore() {
    const nextPage = page + 1;
    const params = new URLSearchParams({ page: String(nextPage), school_id: schoolId ?? "none" });
    if (moduleFilter !== "All") params.set("module", moduleFilter);
    setLoadingMore(true);
    fetchSuperadminData(`activity-logs?${params.toString()}`)
      .then((r) => {
        setLogs((prev) => {
          const next = [...prev, ...(r.logs ?? [])];
          queueMicrotask(() => onLogsChange(next));
          return next;
        });
        setHasMore(Boolean(r.has_more));
        setPage(nextPage);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }

  const filtered = query.trim()
    ? logs.filter(
        (l) =>
          l.action.toLowerCase().includes(query.toLowerCase()) ||
          l.module.toLowerCase().includes(query.toLowerCase()) ||
          (l.description ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : logs;

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2">
          <Icon name="chevronDown" size={16} className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
          <h3 className="text-sm font-semibold text-slate-800">{name}</h3>
        </span>
        <span className="text-xs text-slate-400">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {query.trim() ? "No loaded logs match your search." : "No logs match this filter."}
            </p>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((log) => (
                <LogCard key={log.id} log={log} />
              ))}
            </div>
          )}
          {hasMore && (
            <div className="pt-3 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function ActivityLogsPage() {
  const [schools, setSchools] = useState([]);
  const [systemTotal, setSystemTotal] = useState(0);
  const [modules, setModules] = useState([]);
  const [moduleFilter, setModuleFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [sectionLogs, setSectionLogs] = useState({});

  // summaryLoading only ever needs to gate the very first render — once the
  // school list has loaded once, switching the module filter just refreshes
  // each section in place (they show their own "Loading…" via their own key-
  // driven remount), so there's no need to blank the whole page out again.
  useEffect(() => {
    const params = new URLSearchParams();
    if (moduleFilter !== "All") params.set("module", moduleFilter);
    fetchSuperadminData(`activity-logs/schools?${params.toString()}`)
      .then((r) => {
        setSchools(r.schools ?? []);
        setSystemTotal(r.system_total ?? 0);
        setModules(r.modules ?? []);
      })
      .catch(console.error)
      .finally(() => setSummaryLoading(false));
  }, [moduleFilter]);

  function handleModuleChange(value) {
    setModuleFilter(value);
    setSectionLogs({});
  }

  function handleExport() {
    const allLogs = Object.values(sectionLogs).flat();
    const csv = toCsv(allLogs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "activity-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalLoaded = Object.values(sectionLogs).reduce((sum, arr) => sum + arr.length, 0);
  const grandTotal = schools.reduce((sum, s) => sum + s.total, 0) + systemTotal;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Activity Logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          A running record of platform actions — payments, approvals, and account changes — grouped by school, newest first.
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input {...inputProps("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search loaded logs by action, module, or details…"
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
            disabled={totalLoaded === 0}
            className="ml-auto rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Export loaded logs (CSV)
          </button>
        </div>
      </section>

      {summaryLoading ? (
        <p className="rounded-3xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500 shadow-sm">Loading schools…</p>
      ) : grandTotal === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400 shadow-sm">No activity recorded yet.</p>
      ) : (
        <div className="space-y-4">
          {schools.map((s) => (
            <SchoolSection
              key={`${s.id}-${moduleFilter}`}
              schoolId={s.id}
              name={s.name}
              total={s.total}
              moduleFilter={moduleFilter}
              query={query}
              onLogsChange={(logs) => setSectionLogs((prev) => ({ ...prev, [`school-${s.id}`]: logs }))}
            />
          ))}
          {systemTotal > 0 && (
            <SchoolSection
              key={`system-${moduleFilter}`}
              schoolId={null}
              name="System (no school)"
              total={systemTotal}
              moduleFilter={moduleFilter}
              query={query}
              onLogsChange={(logs) => setSectionLogs((prev) => ({ ...prev, system: logs }))}
            />
          )}
        </div>
      )}
    </div>
  );
}
