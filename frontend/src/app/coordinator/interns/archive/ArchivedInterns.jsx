"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/Pagination";
import ActionMenu from "@/components/ui/ActionMenu";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import { DataList, DataRow, FilterBar, Page, PageHeader, SearchField, Section } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
/**
 * Where an intern marked inactive from the main Interns screen ends up —
 * out of the active roster, but still on file (restore anytime, or delete
 * outright if destroyIntern()'s history check allows it).
 */
const PER_PAGE = 15;

export default function ArchivedInterns() {
  const [interns, setInterns] = useState([]);
  const [options, setOptions] = useState({ companies: [], courses: [] });
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // The server returns one page of the archive; search and filters apply to the whole archive first.
  function load() {
    const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), scope: "archive" });
    if (debouncedQuery) qs.set("search", debouncedQuery);
    if (companyFilter !== "All") qs.set("company", companyFilter);
    if (courseFilter !== "All") qs.set("course", courseFilter);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`interns?${qs}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        // Restoring the last row of the last page leaves that page empty: go back one.
        if (page > 1 && (r.interns ?? []).length === 0 && (r.last_page ?? 1) < page) {
          setPage(r.last_page ?? 1);
          return;
        }
        setInterns(r.interns ?? []);
        setOptions(r.options ?? { companies: [], courses: [] });
        setMeta({ total: r.total ?? 0, last_page: r.last_page ?? 1 });
        setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setPaging(false);
      });
  }

  useEffect(load, [page, debouncedQuery, companyFilter, courseFilter]);

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

  async function handleRestore(intern) {
    setBusyId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not restore intern.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    const intern = toDelete;
    if (!intern) return;
    setBusyId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete intern.");
      setToDelete(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const hasFilters = Boolean(debouncedQuery) || companyFilter !== "All" || courseFilter !== "All";

  return (
    <Page>
      <PageHeader
        back={{ href: "/coordinator/interns", label: "Back to Interns" }}
        title="Archive"
        sentence="Interns marked inactive — restore them anytime, or delete if no longer needed."
      />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or company…"
          aria-label="Search archived interns"
        />
        <select
          value={companyFilter}
          onChange={(e) => { setCompanyFilter(e.target.value); setPage(1); }}
          aria-label="Filter by company"
          className="k-input sm:w-auto"
        >
          <option value="All">All companies</option>
          {options.companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={courseFilter}
          onChange={(e) => { setCourseFilter(e.target.value); setPage(1); }}
          aria-label="Filter by course"
          className="k-input sm:w-auto"
        >
          <option value="All">All courses</option>
          {options.courses.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </FilterBar>

      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : interns.length === 0 ? (
          !hasFilters ? (
            <div className="k-pad"><EmptyState icon="users" title="Nothing archived" text="Inactive interns will show up here." /></div>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No archived interns match this filter.</p>
          )
        ) : (
          <DataList>
            {interns.map((i) => (
              <DataRow
                key={i.deployment_id}
                wrap
                href={`/coordinator/interns/${i.deployment_id}/report`}
                title={i.intern_name}
                sub={
                  <>
                    <span className="block">{[i.student_number, i.course].filter(Boolean).join(" · ") || "—"}</span>
                    <span className="block">
                      {i.company_name ?? "—"}
                      {i.supervisor_name && ` · Supervisor: ${i.supervisor_name}`}
                    </span>
                  </>
                }
                side={<span>{i.hours_completed}h / {i.required_hours}h</span>}
                actions={
                  <ActionMenu
                    label={`Actions for ${i.intern_name}`}
                    items={[
                      { key: "restore", label: "Restore (Mark Active)", icon: "check", onSelect: () => handleRestore(i), disabled: busyId === i.deployment_id },
                      { key: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => setToDelete(i), disabled: busyId === i.deployment_id },
                    ]}
                  />
                }
              />
            ))}
          </DataList>
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={paging} onPageChange={goToPage} />
      </Section>
      <ConfirmDialog open={!!toDelete} title={`Delete ${toDelete?.intern_name}?`} confirmLabel="Delete intern" busy={busyId !== null} error={error} onConfirm={handleDelete} onCancel={() => setToDelete(null)}>
        <p>This removes their account and deployment for good and can&apos;t be undone. It only works while they have no attendance, tasks, evaluations or documents on file.</p>
      </ConfirmDialog>
    </Page>
  );
}
