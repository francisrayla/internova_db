"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import { dayLabel, formatTime, timeAgo } from "@/lib/timeAgo";
import NavIcon from "@/components/NavIcon";
import { EmptyState, ErrorNote, MODULE_ICON, SkeletonList } from "@/components/dean/ui";
import { DataList, DataRow, Section } from "@/components/dash/page";
import { LoadMore } from "@/components/Pagination";

const PER_PAGE = 20;

// Plain-language names for the module column.
const MODULE_LABEL = { Companies: "Companies and supervisors", Interns: "Interns", Documents: "Documents", Evaluations: "Evaluations", Tasks: "Tasks", Reports: "Narrative report", Coordinator: "Account" };

export default function ActivityTab({ coordinator }) {
  const [items, setItems] = useState(null);
  const [modules, setModules] = useState([]);
  const [module, setModule] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    (nextPage, append) => {
      const query = new URLSearchParams({ page: String(nextPage), per_page: String(PER_PAGE) });
      if (module) query.set("module", module);
      return fetchApiData("dean", `coordinator/activity?${query}`)
        .then((data) => {
          // New activity can arrive between two clicks and push rows onto the next page: never list the same row twice.
          setItems((prev) => {
            if (!(append && prev)) return data.items;
            const seen = new Set(prev.map((a) => a.id));
            return [...prev, ...data.items.filter((a) => !seen.has(a.id))];
          });
          setModules(data.modules);
          setHasMore(data.has_more);
          setTotal(data.total ?? 0);
          setPage(nextPage);
          setError(false);
        })
        .catch(() => setError(true));
    },
    [module]
  );

  useEffect(() => {
    load(1, false);
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    await load(page + 1, true);
    setLoadingMore(false);
  }

  // Group the timeline by day, keeping the server's newest-first order.
  const groups = [];
  for (const item of items ?? []) {
    const label = dayLabel(item.created_at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 max-sm:flex-col max-sm:items-stretch">
        <p className="min-w-0 text-sm text-slate-600">Everything {coordinator?.name?.split(" ")[0] ?? "your coordinator"} has done in Internova, newest first.</p>
        {modules.length > 1 && (
          <label className="sm:w-56">
            <span className="sr-only">Filter by area</span>
            <select value={module} onChange={(e) => { setItems(null); setModule(e.target.value); }} className="k-input">
              <option value="">All areas</option>
              {modules.map((m) => (
                <option key={m} value={m}>{MODULE_LABEL[m] ?? m}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <ErrorNote onRetry={() => load(1, false)}>We couldn&apos;t load the activity.</ErrorNote>}
      {items === null && !error && <SkeletonList rows={4} height="h-14" />}

      {items?.length === 0 && (
        <EmptyState
          icon="list"
          title={module ? "Nothing in this area yet" : "No activity yet"}
          text="When your coordinator approves documents, adds interns or supervisors, updates companies or changes the evaluation rubric, it will appear here as a timeline."
        />
      )}

      {groups.map((g) => (
        <Section key={g.label} title={g.label} flush>
          <DataList>
            {g.items.map((a) => (
              <DataRow
                key={a.id}
                wrap
                lead={<span className="shrink-0 self-start pt-0.5 text-slate-500"><NavIcon name={MODULE_ICON[a.module] ?? "list"} size={18} /></span>}
                title={a.action}
                sub={
                  <>
                    {a.description && <span className="block break-words">{a.description}</span>}
                    <span className="block text-xs text-slate-500">{MODULE_LABEL[a.module] ?? a.module}</span>
                  </>
                }
                side={
                  <span className="block text-xs leading-snug text-slate-500">
                    <span className="block">{timeAgo(a.created_at)}</span>
                    <span className="block">{formatTime(a.created_at)}</span>
                  </span>
                }
              />
            ))}
          </DataList>
        </Section>
      ))}

      {hasMore && (
        <div className="dash-card !p-0">
          <LoadMore shown={items.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </div>
      )}
    </div>
  );
}
