"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { LoadMore } from "@/components/Pagination";
import Icon from "@/components/Icon";
import AttendanceSelfies from "@/components/AttendanceSelfies";
import OfflineEntryBadge from "@/components/OfflineEntryBadge";
import LocationFlags from "@/components/LocationFlags";
import RedFlagBadge from "@/components/RedFlagBadge";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, Page, PageHeader, SearchField } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
const STATUS_TONES = { approved: "green", pending: "amber", rejected: "red" };

function buildParams(base, { search }) {
  const params = new URLSearchParams(base);
  if (search) params.set("search", search);
  return params;
}

// One company's slice — collapsed and unfetched until opened, and paginated
// independently, so a company with a long history never buries the others.
// Remounted (via `key`) whenever a filter changes, which re-collapses it.
function CompanySection({ companyId, name, total, filters }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  function fetchPage(nextPage, append) {
    const params = buildParams({ company_id: String(companyId), page: String(nextPage) }, filters);
    (append ? setLoadingMore : setLoading)(true);
    fetchCoordinatorData(`attendance?${params}`)
      .then((r) => {
        setRecords((prev) => (append ? [...prev, ...(r.records ?? [])] : r.records ?? []));
        setHasMore(Boolean(r.has_more));
        setPage(nextPage);
        setLoaded(true);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) fetchPage(1, false);
  }

  return (
    <section className="dash-card is-flush">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="k-row w-full text-left hover:bg-slate-50 max-sm:min-h-[44px]"
      >
        <Icon name="chevronDown" size={16} className={`shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
        <h3 className="k-row-main min-w-0 break-words text-sm font-semibold text-slate-900">{name}</h3>
        <span className="shrink-0 text-xs text-slate-600">
          {total} {total === 1 ? "record" : "records"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-200">
          {error && <p className="k-pad text-sm text-red-700">{error}</p>}
          {loading ? (
            <div className="k-pad"><SkeletonList rows={2} height="h-14" /></div>
          ) : records.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No attendance records match.</p>
          ) : (
            <ul className="k-list">
              {records.map((r) => (
                <li key={r.id}>
                  <div className={`k-row is-wrap items-start border-l-4 ${r.red_flag ? "border-l-red-600" : "border-l-transparent"}`}>
                    <AttendanceSelfies record={r} name={r.intern_name} />
                    <span className="k-row-main">
                      <span className="k-row-title break-words">{r.intern_name}</span>
                      <RedFlagBadge record={r} className="mt-1" />
                      <span className="k-row-sub !whitespace-normal">
                        {r.attendance_date}{r.session_label ? ` (${r.session_label})` : ""} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                        {r.auto_clocked_out && <span className="ml-1.5 inline-block align-middle" title="Forgot to time out — closed automatically after 8 hours, no photo or location"><Pill tone="amber" size="sm">Auto time-out</Pill></span>}
                        {r.edited && <span className="ml-1.5 inline-block align-middle" title="The supervisor corrected the time because the intern forgot to time out"><Pill tone="blue" size="sm">Time corrected</Pill></span>}
                        <OfflineEntryBadge record={r} className="ml-1.5" />
                        <LocationFlags record={r} className="ml-1.5" />
                      </span>
                    </span>
                    {r.status !== "approved" && (
                      <span className="k-row-side"><Pill tone={STATUS_TONES[r.status] ?? "slate"} size="sm" className="capitalize">{r.status}</Pill></span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <LoadMore shown={records.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={() => fetchPage(page + 1, true)} />
        </div>
      )}
    </section>
  );
}

export default function AttendanceMonitoring() {
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = { search: debouncedSearch };

  useEffect(() => {
    const params = buildParams({}, { search: debouncedSearch });
    fetchCoordinatorData(`attendance/companies?${params}`)
      .then((r) => {
        setCompanies(r.companies ?? []);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [debouncedSearch]);

  const hasFilters = Boolean(search);
  const visible = hasFilters ? companies.filter((c) => c.total > 0) : companies;

  return (
    <Page>
      <PageHeader title="Attendance" sentence="Read-only — attendance is logged and verified by each intern's supervisor, grouped here by company, newest first." />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search intern name…"
          aria-label="Search intern name"
        />
        {hasFilters && (
          <Btn variant="ghost" onClick={() => setSearch("")}>Clear search</Btn>
        )}
      </FilterBar>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <section className="dash-card"><SkeletonList rows={3} height="h-12" /></section>
      ) : visible.length === 0 ? (
        <section className="dash-card">
          <EmptyState
            icon="attendance"
            title={hasFilters ? "No attendance records match these filters." : "No attendance records yet."}
            text={hasFilters ? "Try a different name, or clear the search." : "Records show up here once interns start clocking in."}
          />
        </section>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <CompanySection
              key={`${c.id}-${debouncedSearch}`}
              companyId={c.id}
              name={c.name}
              total={c.total}
              filters={filters}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
