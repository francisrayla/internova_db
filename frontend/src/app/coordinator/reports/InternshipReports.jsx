"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import Pagination from "@/components/Pagination";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import { Btn, DataList, DataRow, FilterBar, Page, PageHeader, SearchField, Section } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
const PER_PAGE = 15;

export default function InternshipReports() {
  const [interns, setInterns] = useState([]);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // One page at a time; the search runs on the server over every intern.
  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (debouncedQuery) qs.set("search", debouncedQuery);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`interns?${qs}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        setInterns(r.interns ?? []);
        setMeta({ total: r.total ?? 0, last_page: r.last_page ?? 1 });
        setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setPaging(false);
      });
  }, [page, debouncedQuery]);

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

  return (
    <Page>
      <PageHeader title="Internship Reports" sentence="Generate a formal, printable progress report for any intern — hours rendered, task standing, and every evaluation on file." />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by intern or company…"
          aria-label="Search interns"
        />
      </FilterBar>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-14" /></div>
        ) : interns.length === 0 ? (
          !debouncedQuery ? (
            <div className="k-pad"><EmptyState icon="reports" title="No interns have been deployed yet." text="Once interns are deployed you can generate their reports here." /></div>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No interns match this search.</p>
          )
        ) : (
          <DataList>
            {interns.map((i) => (
              <DataRow
                key={i.deployment_id}
                wrap
                title={i.intern_name}
                sub={`${i.company_name ?? "—"} · ${i.hours_completed}h / ${i.required_hours}h`}
                actions={<Btn sm href={`/coordinator/interns/${i.deployment_id}/report`}>View report</Btn>}
              />
            ))}
          </DataList>
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={paging} onPageChange={goToPage} />
      </Section>
    </Page>
  );
}
