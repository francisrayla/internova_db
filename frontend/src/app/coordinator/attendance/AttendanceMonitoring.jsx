"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import Icon from "@/components/Icon";
import AttendanceSelfies from "@/components/AttendanceSelfies";
import OfflineEntryBadge from "@/components/OfflineEntryBadge";
import LocationFlags from "@/components/LocationFlags";

import { inputProps } from "@/lib/inputRules";
const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

const inputClass = "rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

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
          {total} {total === 1 ? "record" : "records"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          {error && <p className="px-6 py-3 text-sm text-red-700">{error}</p>}
          {loading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : records.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No attendance records match.</p>
          ) : (
            records.map((r) => {
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3.5 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <AttendanceSelfies record={r} name={r.intern_name} />
                    <div>
                      <p className="font-medium text-slate-900">{r.intern_name}</p>
                      <p className="text-xs text-slate-500">
                        {r.attendance_date}{r.session_label ? ` (${r.session_label})` : ""} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                        {r.auto_clocked_out && <span className="ml-1.5 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700" title="Forgot to time out — closed automatically after 8 hours, no photo or location">Auto time-out</span>}
                        {r.edited && <span className="ml-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700" title="The supervisor corrected the time because the intern forgot to time out">Time corrected</span>}
                        <OfflineEntryBadge record={r} className="ml-1.5" />
                        <LocationFlags record={r} className="ml-1.5" />
                      </p>
                    </div>
                  </div>
                  {r.status !== "approved" && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                  )}
                </div>
              );
            })
          )}
          {hasMore && (
            <div className="border-t border-slate-100 py-3 text-center">
              <button
                type="button"
                onClick={() => fetchPage(page + 1, true)}
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Attendance</h2>
        <p className="mt-1 text-sm text-slate-600">
          Read-only — attendance is logged and verified by each intern&apos;s supervisor, grouped here by company, newest first.
        </p>
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <input {...inputProps("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search intern name…"
          className={`${inputClass} min-w-52 flex-1`}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Clear search
          </button>
        )}
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500 shadow-sm">Loading companies…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400 shadow-sm">
          {hasFilters ? "No attendance records match these filters." : "No attendance records yet."}
        </p>
      ) : (
        <div className="space-y-4">
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
    </div>
  );
}
