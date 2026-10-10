"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import InternCard from "@/components/dean/InternCard";
import NavIcon from "@/components/NavIcon";
import { Btn } from "@/components/dash/page";
import { LoadMore } from "@/components/Pagination";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

export default function InternsTab() {
  const [interns, setInterns] = useState(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // 12 at a time; "Load more" adds the next page under the ones already shown.
  const load = useCallback((nextPage = 1) => {
    fetchApiData("dean", `interns?page=${nextPage}&per_page=12`)
      .then((d) => {
        // The list is ordered by risk, which can change between two clicks: never show the same intern twice.
        setInterns((prev) => {
          if (!(nextPage > 1 && prev)) return d.interns;
          const seen = new Set(prev.map((i) => i.deployment_id));
          return [...prev, ...d.interns.filter((i) => !seen.has(i.deployment_id))];
        });
        setPage(nextPage);
        setTotal(d.total ?? d.interns.length);
        setHasMore(Boolean(d.has_more));
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingMore(false));
  }, []);

  useEffect(() => { load(1); }, [load]);

  function loadMore() {
    setLoadingMore(true);
    load(page + 1);
  }

  if (error) return <ErrorNote onRetry={() => load(1)}>We couldn&apos;t load the interns.</ErrorNote>;
  if (!interns) return <SkeletonList rows={3} height="h-32" />;
  if (interns.length === 0) {
    return <EmptyState icon="users" title="No interns yet" text="Interns your coordinator adds will appear here with their hours and narrative report progress." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="min-w-0 text-sm text-slate-600">The interns your coordinator handles. Tap one for the full picture.</p>
        <Btn href="/dean/interns" sm className="max-sm:w-full">Open the Interns page <NavIcon name="arrow" size={14} /></Btn>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {interns.map((i) => <InternCard key={i.deployment_id} intern={i} />)}
      </div>
      {hasMore && (
        <div className="dash-card !p-0">
          <LoadMore shown={interns.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </div>
      )}
    </div>
  );
}
