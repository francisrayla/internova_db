"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { inputProps } from "@/lib/inputRules";
import AddInternModal from "@/components/AddInternModal";
import Icon from "@/components/Icon";
import Pagination from "@/components/Pagination";
import ActionMenu from "@/components/ui/ActionMenu";
import { Banner, EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import { Btn, Chip, Chips, FilterBar, Page, PageHeader, SearchField, Section, btnClass } from "@/components/dash/page";
import InternRoster from "@/components/coordinator/InternRoster";
import useInternActions from "@/components/coordinator/useInternActions";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "completed", label: "Completed" },
];

const PER_PAGE = 15;

const TILES = [
  { key: "active", label: "Active", help: "Working with an account", tone: "is-ok" },
  { key: "invitation_pending", label: "Pending accounts", help: "Not set up yet. Tap to fix emails", tone: "is-warn", href: "/coordinator/interns/pending" },
  { key: "needs_attention", label: "Needs attention", help: "Company has no supervisor, no clock-in, or behind", tone: "is-risk" },
  { key: "completed", label: "Completed", help: "Finished their hours", tone: "is-info" },
];

export default function InternMonitoring() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const companyParam = params.get("company");

  const [interns, setInterns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [options, setOptions] = useState({ companies: [], courses: [] });
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // The dashboard links here with ?filter=needs_attention or ?filter=completed.
  const [filter, setFilter] = useState(() => (FILTERS.some((f) => f.key === params.get("filter")) ? params.get("filter") : "all"));
  const [companyFilter, setCompanyFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // The server filters, searches and cuts the list into pages (summary and dropdown options stay for the whole list).
  function fetchList() {
    const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), scope: "roster", filter });
    if (debouncedQuery) qs.set("search", debouncedQuery);
    if (companyFilter !== "All") qs.set("company", companyFilter);
    if (courseFilter !== "All") qs.set("course", courseFilter);
    if (companyParam) qs.set("company_id", companyParam);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`interns?${qs}`)
      .then((internsRes) => {
        if (request !== requestRef.current) return;
        // The page we were on no longer exists (its last intern was archived or moved): step back to the last one.
        if (page > 1 && (internsRes.interns ?? []).length === 0 && (internsRes.last_page ?? 1) < page) {
          setPage(internsRes.last_page ?? 1);
          return;
        }
        setInterns(internsRes.interns ?? []);
        setSummary(internsRes.summary ?? null);
        setOptions(internsRes.options ?? { companies: [], courses: [] });
        setMeta({ total: internsRes.total ?? 0, last_page: internsRes.last_page ?? 1 });
        setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setPaging(false);
      });
  }

  function fetchCompanies() {
    fetchCoordinatorData("companies")
      .then((r) => setCompanies(r.companies ?? []))
      .catch(() => setCompanies([]));
  }

  // After an action (archive, add, ...): refresh the current page.
  function load() {
    fetchList();
    fetchCompanies();
  }

  useEffect(fetchList, [page, filter, companyFilter, courseFilter, debouncedQuery, companyParam]);
  useEffect(fetchCompanies, []);

  const { menuFor, dialogs } = useInternActions({
    reload: load,
    onNotice: (m) => { setError(""); setNotice(m); },
    onError: (m) => { setNotice(""); setError(m); },
  });

  const companyFilterName = companyParam ? companies.find((c) => String(c.id) === companyParam)?.company_name : null;
  const extraFilters = (companyFilter !== "All" ? 1 : 0) + (courseFilter !== "All" ? 1 : 0);
  const defaultView = filter === "all" && extraFilters === 0 && !debouncedQuery && !companyParam;

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

  function pick(key) {
    setFilter((cur) => (cur === key ? "all" : key));
    setPage(1);
  }

  function clearCompanyParam() {
    router.replace(pathname, { scroll: false });
    setPage(1);
  }

  return (
    <Page>
      <PageHeader title="Interns" sentence="Every intern deployed under your school: hours, tasks and evaluation progress at a glance.">
        <Btn variant="primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> Add intern
        </Btn>
        <ActionMenu
          label="More intern options"
          text="More"
          icon="chevronDown"
          items={[
            { key: "import", label: "Import from Excel", icon: "upload", href: "/coordinator/interns/import" },
            { key: "archive", label: "View archive", icon: "download", href: "/coordinator/interns/archive" },
          ]}
        />
      </PageHeader>

      {(summary?.invitation_pending ?? 0) > 0 && (
        <Link href="/coordinator/interns/pending" className="k-note is-warn">
          <span className="min-w-0">
            <span className="font-semibold">{summary.invitation_pending} {summary.invitation_pending === 1 ? "intern has" : "interns have"} not set up an account yet.</span>{" "}
            They are not on this list and cannot get tasks. Wrong email? Fix it there.
          </span>
          <span className="shrink-0 font-semibold underline">Review</span>
        </Link>
      )}

      {summary && (
        <div className="dash-strip" style={{ "--cols": TILES.length }}>
          {TILES.map((t) => {
            const body = (
              <>
                <span className="dash-fig-label">{t.label}</span>
                <span className={`dash-fig-value ${t.tone}`}>{summary[t.key] ?? 0}</span>
                <span className="dash-fig-note hidden sm:block">{t.help}</span>
              </>
            );
            return t.href ? (
              <Link key={t.key} href={t.href} className="dash-fig">
                {body}
              </Link>
            ) : (
              <button
                key={t.key}
                type="button"
                onClick={() => pick(t.key)}
                aria-pressed={filter === t.key}
                className={`dash-fig ${filter === t.key ? "is-on" : ""}`}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, student no. or company…"
          aria-label="Search interns"
        />
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={btnClass("secondary", { className: "w-full justify-between sm:hidden" })}
        >
          <span>Filters{extraFilters > 0 ? ` (${extraFilters})` : ""}</span>
          <Icon name="chevronDown" size={16} />
        </button>
        <div className={`${showFilters ? "grid" : "hidden"} w-full grid-cols-1 gap-3 sm:flex sm:w-auto sm:items-center`}>
          <select value={companyFilter} onChange={(e) => { setCompanyFilter(e.target.value); setPage(1); }} aria-label="Filter by company" className="k-input sm:w-auto">
            <option value="All">All companies</option>
            {options.companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setPage(1); }} aria-label="Filter by course" className="k-input sm:w-auto">
            <option value="All">All courses</option>
            {options.courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Chips label="Filter by status">
          {FILTERS.map((f) => (
            <Chip key={f.key} on={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}>
              {f.label}
            </Chip>
          ))}
          {companyParam && (
            <button type="button" onClick={clearCompanyParam} className="k-chip is-on">
              <span className="truncate">Company: {companyFilterName ?? "selected"}</span>
              <Icon name="x" size={12} />
              <span className="sr-only">Clear company filter</span>
            </button>
          )}
        </Chips>
      </FilterBar>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : interns.length === 0 ? (
          defaultView ? (
            <div className="k-pad">
              <EmptyState
                icon="users"
                title="No interns yet"
                text="Add your first intern, or import a whole class from an Excel file. They get an email invitation to set up their account."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Btn variant="primary" onClick={() => setShowAdd(true)}>Add intern</Btn>
                    <Btn href="/coordinator/interns/import">Import from Excel</Btn>
                  </div>
                }
              />
            </div>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No interns match these filters. Try clearing the search or picking All.</p>
          )
        ) : (
          <InternRoster interns={interns} menuFor={menuFor} />
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={paging} onPageChange={goToPage} />
      </Section>

      {dialogs}
      {showAdd && <AddInternModal companies={companies} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setNotice("Intern added. They will get an email invitation."); load(); }} />}
    </Page>
  );
}
