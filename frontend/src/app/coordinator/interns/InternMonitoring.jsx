"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { inputProps } from "@/lib/inputRules";
import AddInternModal from "@/components/AddInternModal";
import Icon from "@/components/Icon";
import Pagination, { PAGE_SIZE } from "@/components/Pagination";
import ActionMenu from "@/components/ui/ActionMenu";
import { Banner, EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import InternRoster from "@/components/coordinator/InternRoster";
import useInternActions from "@/components/coordinator/useInternActions";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "invitation_pending", label: "Invitation pending" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "completed", label: "Completed" },
];

const TILES = [
  { key: "active", label: "Active", help: "Working with an account", tone: "text-emerald-700" },
  { key: "invitation_pending", label: "Invitation pending", help: "Account not set up yet", tone: "text-amber-700" },
  { key: "needs_attention", label: "Needs attention", help: "Company has no supervisor, no clock-in, or behind", tone: "text-red-700" },
  { key: "completed", label: "Completed", help: "Finished their hours", tone: "text-blue-700" },
];

function matches(i, filter) {
  if (filter === "all") return true;
  if (filter === "needs_attention") return (i.attention ?? []).length > 0;
  return i.display_status === filter;
}

export default function InternMonitoring() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const companyParam = params.get("company");

  const [interns, setInterns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);

  function fetchAll() {
    Promise.all([fetchCoordinatorData("interns"), fetchCoordinatorData("companies")])
      .then(([internsRes, companiesRes]) => {
        setInterns(internsRes.interns ?? []);
        setSummary(internsRes.summary ?? null);
        setCompanies(companiesRes.companies ?? []);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // First load happens with loading already true; later reloads show the skeleton again.
  function load() {
    setLoading(true);
    fetchAll();
  }

  useEffect(fetchAll, []);

  const { menuFor, dialogs } = useInternActions({
    reload: load,
    onNotice: (m) => { setError(""); setNotice(m); },
    onError: (m) => { setNotice(""); setError(m); },
  });

  // Archived (inactive) interns live on the Archive page, not in this list.
  const roster = useMemo(() => interns.filter((i) => i.status !== "inactive"), [interns]);
  const companyOptions = useMemo(() => [...new Set(roster.map((i) => i.company_name).filter(Boolean))].sort(), [roster]);
  const courseOptions = useMemo(() => [...new Set(roster.map((i) => i.course).filter(Boolean))].sort(), [roster]);
  const companyFilterName = companyParam ? roster.find((i) => String(i.company_id) === companyParam)?.company_name : null;

  const filtered = roster.filter((i) => {
    const q = query.trim().toLowerCase();
    return (
      matches(i, filter) &&
      (companyFilter === "All" || i.company_name === companyFilter) &&
      (courseFilter === "All" || i.course === courseFilter) &&
      (!companyParam || String(i.company_id) === companyParam) &&
      (!q || [i.intern_name, i.company_name, i.student_number, i.supervisor_name].some((v) => v?.toLowerCase().includes(q)))
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const extraFilters = (companyFilter !== "All" ? 1 : 0) + (courseFilter !== "All" ? 1 : 0);

  function pick(key) {
    setFilter((cur) => (cur === key ? "all" : key));
    setPage(1);
  }

  function clearCompanyParam() {
    router.replace(pathname, { scroll: false });
    setPage(1);
  }

  const selectClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:w-auto";

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">Interns</h2>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Icon name="plus" size={15} /> Add intern
            </button>
            <ActionMenu
              label="More intern options"
              text="More"
              icon="chevronDown"
              items={[
                { key: "import", label: "Import from Excel", icon: "upload", href: "/coordinator/interns/import" },
                { key: "archive", label: "View archive", icon: "download", href: "/coordinator/interns/archive" },
              ]}
            />
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">Every intern deployed under your school: hours, tasks and evaluation progress at a glance.</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {TILES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              aria-pressed={filter === t.key}
              className={`min-w-0 rounded-2xl border bg-white p-4 text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
                filter === t.key ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200 hover:border-blue-300"
              }`}
            >
              <span className={`block text-xl font-bold ${t.tone}`}>{summary[t.key] ?? 0}</span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-slate-800">{t.label}</span>
              <span className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">{t.help}</span>
            </button>
          ))}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            {...inputProps("search")}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search by name, student no. or company…"
            aria-label="Search interns"
            className="w-full min-w-0 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-sm"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="inline-flex items-center justify-between gap-2 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:hidden"
          >
            <span>Filters{extraFilters > 0 ? ` (${extraFilters})` : ""}</span>
            <Icon name="chevronDown" size={16} />
          </button>
          <div className={`${showFilters ? "grid" : "hidden"} grid-cols-1 gap-3 sm:flex sm:items-center`}>
            <select value={companyFilter} onChange={(e) => { setCompanyFilter(e.target.value); setPage(1); }} aria-label="Filter by company" className={selectClass}>
              <option value="All">All companies</option>
              {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setPage(1); }} aria-label="Filter by course" className={selectClass}>
              <option value="All">All courses</option>
              {courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(1); }}
              aria-pressed={filter === f.key}
              className={`rounded-full border px-3 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                filter === f.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
          {companyParam && (
            <button type="button" onClick={clearCompanyParam} className="relative inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <span className="truncate">Company: {companyFilterName ?? "selected"}</span>
              <Icon name="x" size={12} />
              <span className="sr-only">Clear company filter</span>
            </button>
          )}
        </div>
      </section>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-4"><SkeletonList rows={4} height="h-16" /></div>
        ) : filtered.length === 0 ? (
          roster.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="users"
                title="No interns yet"
                text="Add your first intern, or import a whole class from an Excel file. They get an email invitation to set up their account."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={() => setShowAdd(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add intern</button>
                    <Link href="/coordinator/interns/import" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Import from Excel</Link>
                  </div>
                }
              />
            </div>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No interns match these filters. Try clearing the search or picking All.</p>
          )
        ) : (
          <InternRoster interns={paginated} menuFor={menuFor} />
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </section>

      {dialogs}
      {showAdd && <AddInternModal companies={companies} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setNotice("Intern added. They will get an email invitation."); load(); }} />}
    </div>
  );
}
