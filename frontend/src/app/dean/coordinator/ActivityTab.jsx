"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import { dayLabel, formatTime, timeAgo } from "@/lib/timeAgo";
import Icon from "@/components/Icon";
import { EmptyState, ErrorNote, MODULE_ICON, SkeletonList } from "@/components/dean/ui";

const PER_PAGE = 20;

// Plain-language names for the module column.
const MODULE_LABEL = { Companies: "Companies and supervisors", Interns: "Interns", Documents: "Documents", Evaluations: "Evaluations", Tasks: "Tasks", Reports: "Narrative report", Coordinator: "Account" };

export default function ActivityTab({ coordinator }) {
  const [items, setItems] = useState(null);
  const [modules, setModules] = useState([]);
  const [module, setModule] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    (nextPage, append) => {
      const query = new URLSearchParams({ page: String(nextPage), per_page: String(PER_PAGE) });
      if (module) query.set("module", module);
      return fetchApiData("dean", `coordinator/activity?${query}`)
        .then((data) => {
          setItems((prev) => (append && prev ? [...prev, ...data.items] : data.items));
          setModules(data.modules);
          setHasMore(data.has_more);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-500">Everything {coordinator?.name?.split(" ")[0] ?? "your coordinator"} has done in Internova, newest first.</p>
        {modules.length > 1 && (
          <label className="text-sm">
            <span className="sr-only">Filter by area</span>
            <select value={module} onChange={(e) => { setItems(null); setModule(e.target.value); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
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
        <section key={g.label}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.label}</h3>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {g.items.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                  <Icon name={MODULE_ICON[a.module] ?? "list"} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{a.action}</p>
                  {a.description && <p className="break-words text-sm text-slate-600">{a.description}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{MODULE_LABEL[a.module] ?? a.module}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400">
                  <p>{timeAgo(a.created_at)}</p>
                  <p>{formatTime(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore && (
        <div className="text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-xl border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
