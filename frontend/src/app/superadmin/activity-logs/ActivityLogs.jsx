"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import Icon from "@/components/Icon";
import { LoadMore } from "@/components/Pagination";
import { Btn, DataList, DataRow, EmptyState, FilterBar, Page, PageHeader, Pill, SearchField, Select, SkeletonList } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
const MODULE_TONES = {
  Schools: "blue",
  Payment: "green",
  Subscription: "slate",
  Plans: "amber",
  Inquiries: "blue",
};

function moduleTone(module) {
  return MODULE_TONES[module] ?? "slate";
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
    <DataRow
      wrap
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={moduleTone(log.module)} size="sm">{log.module}</Pill>
          <span>{log.action}</span>
        </span>
      }
      sub={
        <>
          {log.description && <span className="block">{log.description}</span>}
          <span className="block text-xs">{log.user}</span>
        </>
      }
      side={<span className="text-xs">{log.timestamp}</span>}
    />
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
    <section className="dash-card is-flush">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="k-row w-full text-left"
      >
        <Icon name="chevronDown" size={16} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        <span className="k-row-main">
          <h3 className="k-row-title">{name}</h3>
        </span>
        <span className="k-row-side">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--ui-line)" }}>
          {loading ? (
            <div className="k-pad"><SkeletonList rows={2} height="h-12" /></div>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm" style={{ color: "var(--ui-muted)" }}>
              {query.trim() ? "No loaded logs match your search." : "No logs match this filter."}
            </p>
          ) : (
            <DataList>
              {filtered.map((log) => (
                <LogCard key={log.id} log={log} />
              ))}
            </DataList>
          )}
          <LoadMore shown={logs.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
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
    <Page>
      <PageHeader
        title="Activity Logs"
        sentence="A running record of platform actions — payments, approvals, and account changes — grouped by school, newest first."
      >
        <Btn onClick={handleExport} disabled={totalLoaded === 0}>
          Export loaded logs (CSV)
        </Btn>
      </PageHeader>

      <FilterBar>
        <SearchField {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search loaded logs…"
          aria-label="Search loaded logs"
        />
        <Select value={moduleFilter} onChange={(e) => handleModuleChange(e.target.value)} aria-label="Filter by module" className="sm:w-auto">
          <option value="All">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>
      </FilterBar>

      {summaryLoading ? (
        <section className="dash-card"><SkeletonList rows={3} height="h-12" /></section>
      ) : grandTotal === 0 ? (
        <section className="dash-card">
          <EmptyState icon="activity" title="No activity recorded yet." text="Payments, approvals and account changes will be listed here." />
        </section>
      ) : (
        <div className="grid gap-3">
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
    </Page>
  );
}
