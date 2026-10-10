"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import InternCard from "@/components/dean/InternCard";
import InternTable, { SORT_DEFAULT_DIR } from "@/components/dean/InternTable";
import DownloadDocxButton from "@/components/narrative-report/DownloadDocxButton";
import { GROUPS, GROUP_ORDER } from "@/components/dean/monitoring";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";
import Pagination from "@/components/Pagination";
import { Chip, Chips, FilterBar, Page, PageHeader, SearchField, btnClass } from "@/components/dash/page";

const VIEW_KEY = "dean.internsView";

function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

// Colour of the figure for each status group (soft text colours, see dash-fig-value in page.css).
const STRIP_TONE = { red: "is-risk", amber: "is-warn", green: "is-ok", blue: "is-info" };

const PER_PAGE = 18;

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];


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
  // The server pages the list (filters and search run on every intern first).
  const [page, setPage] = useState(1);
  const [paging, setPaging] = useState(false);
  // Table column order: asked from the server so it covers every page, not just the 18 rows on screen.
  const [sort, setSort] = useState({ key: "", dir: "asc" });

  function sortBy(key) {
    setPaging(true);
    setPage(1);
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: SORT_DEFAULT_DIR[key] ?? "desc" }));
  }

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
  // Only the newest request may fill the list: a slow earlier answer must not overwrite a later search, sort or page.
  const latest = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    const query = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (debounced) query.set("search", debounced);
    if (status) query.set("status", status);
    if (companyId) query.set("company_id", companyId);
    if (attention) query.set("attention", "1");
    if (group) query.set("group", group);
    if (sort.key) {
      query.set("sort", sort.key);
      query.set("dir", sort.dir);
    }
    const mine = ++latest.current;
    fetchApiData("dean", `interns?${query}`)
      .then((d) => {
        if (mine !== latest.current) return;
        // The list shrank while this page was open (an intern moved or was archived): step back to the last page that exists.
        if (d.interns.length === 0 && page > 1 && d.last_page >= 1 && page > d.last_page) {
          setPage(d.last_page);
          return;
        }
        setData(d);
        setError(false);
      })
      .catch(() => { if (mine === latest.current) setError(true); })
      .finally(() => { if (mine === latest.current) setPaging(false); });
  }, [debounced, status, companyId, attention, group, page, sort]);

  useEffect(load, [load]);

  // A changed filter always starts again from the first page.
  function pickFilter(set, value) {
    setPaging(true);
    set(value);
    setPage(1);
  }

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

  const filtering = Boolean(debounced || status || companyId || attention || group);

  return (
    <Page>
      <PageHeader title="Interns" sentence="Every intern in your school, read-only. At risk interns are listed first. Tap one to see their attendance, journal, tasks, documents and narrative report." />

      {data?.summary && (
        <div className="dash-strip" style={{ "--cols": GROUP_ORDER.length }} role="group" aria-label="Filter by status group">
          {GROUP_ORDER.map((key) => {
            const g = GROUPS[key];
            const on = group === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => pickFilter(setGroup, on ? "" : key)}
                className={`dash-fig ${on ? "is-on" : ""}`}
              >
                <span className="dash-fig-label">{g.label}</span>
                <span className={`dash-fig-value ${STRIP_TONE[g.tone]}`}>{data.summary[key]}</span>
                <span className="dash-fig-note hidden sm:block">{g.help}</span>
              </button>
            );
          })}
        </div>
      )}

      <FilterBar>
        <SearchField type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or student number" aria-label="Search interns" className="sm:max-w-sm" />
        {data?.companies?.length > 1 && (
          <select value={companyId} onChange={(e) => pickFilter(setCompanyId, e.target.value)} aria-label="Filter by company" className="k-input">
            <option value="">All companies</option>
            {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <DownloadDocxButton
          docxUrl="/api/dean/report/docx"
          label="Download school report (.docx)"
          fallbackName="School_Monitoring_Report.docx"
          className={btnClass("secondary", { className: "w-full sm:ml-auto sm:w-auto" })}
          onError={setDownloadError}
        />
        <Chips label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.key} on={status === f.key} onClick={() => pickFilter(setStatus, f.key)}>
              {f.label}
            </Chip>
          ))}
          <Chip on={attention} onClick={() => pickFilter(setAttention, !attention)}>
            Has a flag
          </Chip>
        </Chips>
      </FilterBar>
      {downloadError && <p className="k-note is-risk" role="alert">{downloadError}</p>}

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
            <p className="text-sm text-slate-500">{data.total ?? data.interns.length} {(data.total ?? data.interns.length) === 1 ? "intern" : "interns"}</p>
            <div className="k-seg hidden lg:inline-flex" role="group" aria-label="Choose how to show interns">
              {[["cards", "Cards"], ["table", "Table"]].map(([key, label]) => (
                <button key={key} type="button" aria-pressed={view === key} onClick={() => chooseView(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === "table" && (
            <div className="hidden min-w-0 lg:block">
              <InternTable interns={data.interns} sort={sort} onSort={sortBy} />
            </div>
          )}
          <div className={`grid grid-cols-1 gap-3 lg:grid-cols-2 ${view === "table" ? "lg:hidden" : ""}`}>
            {data.interns.map((i) => <InternCard key={i.deployment_id} intern={i} />)}
          </div>
          <div className="dash-card !p-0">
            <Pagination page={page} totalPages={data.last_page ?? 1} total={data.total} loading={paging} onPageChange={goToPage} />
          </div>
        </>
      )}
    </Page>
  );
}
