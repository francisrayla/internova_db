"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import NavIcon from "@/components/NavIcon";
import { Avatar, EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import { DataList, DataRow, FilterBar, Page, PageHeader, SearchField, Section } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
function CompanyRow({ company, activeCount, totalCount }) {
  return (
    <DataRow
      wrap
      href={`/coordinator/tasks/company/${company.id}`}
      lead={<Avatar name={company.company_name} size={40} />}
      title={<span className="break-words">{company.company_name}</span>}
      sub={
        <>
          {totalCount} task{totalCount === 1 ? "" : "s"} total
          {activeCount > 0 ? ` · ${activeCount} active` : ""}
        </>
      }
      side={<span className="text-slate-400"><NavIcon name="arrow" size={16} /></span>}
    />
  );
}

/**
 * Coordinators are view-only for tasks — supervisors assign and manage the
 * actual work. Since one coordinator's interns are spread across many
 * companies, this screen is just an index: pick a company, then see (and
 * search/filter) its tasks on the next screen — never one giant list mixing
 * every company together.
 */
export default function TaskMonitoring() {
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    // Only the per-company figures come back (no task rows): the tasks themselves load on the company screen.
    fetchCoordinatorData("tasks?view=summary")
      .then((r) => {
        setCompanies(r.companies ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function retry() {
    setError("");
    setLoading(true);
    load();
  }

  const visibleCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.company_name?.toLowerCase().includes(q));
  }, [companies, search]);

  return (
    <Page>
      <PageHeader title="Tasks" sentence="Pick a company to see the tasks for its interns — supervisors assign and manage the actual work." />

      {companies.length > 0 && (
        <FilterBar>
          <SearchField
            {...inputProps("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies…"
            aria-label="Search companies"
          />
        </FilterBar>
      )}

      {error && <ErrorNote onRetry={retry}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : companies.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="building" title="No companies with deployed interns yet" text="Once an intern is deployed to a company, its tasks show up here." />
          </div>
        ) : visibleCompanies.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">No companies match your search.</p>
        ) : (
          <DataList>
            {visibleCompanies.map((c) => (
              <CompanyRow key={c.id} company={c} activeCount={c.active ?? 0} totalCount={c.total ?? 0} />
            ))}
          </DataList>
        )}
      </Section>
    </Page>
  );
}
