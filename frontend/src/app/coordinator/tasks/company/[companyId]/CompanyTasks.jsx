"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import DueDateBadge from "@/components/DueDateBadge";
import TaskHistoryRow from "@/components/TaskHistoryRow";
import { isAwaitingRating } from "@/lib/taskState";
import { useTaskHistory } from "@/lib/useTaskHistory";
import { LoadMore } from "@/components/Pagination";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { DataList, DataRow, FilterBar, Page, PageHeader, SearchField, Section, TabStrip } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
const STATUS_TONES = { pending: "slate", in_progress: "blue", completed: "green" };

const STATUS_LABELS = { pending: "Pending", in_progress: "Ongoing", completed: "Done" };

const PRIORITY_TONES = { low: "slate", medium: "amber", high: "red" };

function TaskRow({ task }) {
  return (
    <DataRow
      wrap
      href={`/coordinator/tasks/${task.id}`}
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill tone={PRIORITY_TONES[task.priority] ?? "slate"} size="sm" className="capitalize">{task.priority}</Pill>
          <span className="min-w-0 break-words">{task.title}</span>
          {task.is_group && <Pill tone="slate" size="sm">Group</Pill>}
        </span>
      }
      sub={
        <>
          <span className="block">
            {task.assignees.map((a) => a.name).join(", ")} · Assigned {task.created_at}
            {task.subtask_total > 0 ? ` · ${task.subtask_done}/${task.subtask_total} subtasks done` : ""}
          </span>
          <span className="mt-1 block"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></span>
        </>
      }
      side={
        isAwaitingRating(task) ? (
          <Pill tone="blue" size="sm">Awaiting rating</Pill>
        ) : (
          <Pill tone={STATUS_TONES[task.status] ?? "slate"} size="sm">{STATUS_LABELS[task.status]}</Pill>
        )
      }
    />
  );
}

/**
 * View-only, scoped to one company — the coordinator picked it from the
 * index screen. Only that company's ACTIVE interns show up in the filter
 * (a completed/withdrawn deployment isn't someone whose tasks you'd be
 * checking on day to day).
 */
export default function CompanyTasks() {
  const params = useParams();
  const companyId = params.companyId;

  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ active: 0, history: 0 });
  const [reloads, setReloads] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [interns, setInterns] = useState([]);
  const [view, setView] = useState("active");
  const [internFilter, setInternFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    // This company's open work (all of it) and its active interns for the dropdown; History is fetched a page at a time below.
    Promise.all([
      fetchCoordinatorData(`tasks?view=active&company_id=${companyId}`),
      fetchCoordinatorData(`interns?page=1&per_page=50&scope=roster&filter=active&company_id=${companyId}`),
    ])
      .then(([tasksRes, internsRes]) => {
        setTasks(tasksRes.tasks ?? []);
        setCounts(tasksRes.counts ?? { active: (tasksRes.tasks ?? []).length, history: 0 });
        setCompanies(tasksRes.companies ?? []);
        setInterns(internsRes.interns ?? []);
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
    setReloads((n) => n + 1);
    load();
  }

  const company = companies.find((c) => String(c.id) === String(companyId));
  const companyActiveInterns = interns;

  // A finished task still needs the supervisor's rating before it's truly
  // closed out — until then it stays visible here, not History.
  const activeTasks = tasks;

  const history = useTaskHistory({
    fetcher: (qs) => fetchCoordinatorData(`tasks?${qs}`),
    enabled: view === "history",
    search,
    filters: { company_id: companyId, user_id: internFilter },
    refreshKey: reloads,
  });
  const historyTasks = history.items;

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeTasks.filter((t) => {
      if (internFilter && !t.assignees.some((a) => String(a.user_id) === internFilter)) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.assignees.some((a) => a.name?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, internFilter, statusFilter, search]);

  return (
    <Page>
      <PageHeader
        back={{ href: "/coordinator/tasks", label: "Back to Companies" }}
        title={`${company?.company_name ?? "Company"} — Tasks`}
        sentence="Viewing only — supervisors assign and manage the actual work."
      />

      <TabStrip
        label="Task view"
        tabs={[
          { key: "active", label: "Active" },
          { key: "history", label: `History (${counts.history})` },
        ]}
        active={view}
        onChange={setView}
      />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by intern name or task title…"
          aria-label="Search tasks"
        />
        {view === "active" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="k-input sm:w-auto">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">Ongoing</option>
          </select>
        )}
        <select value={internFilter} onChange={(e) => setInternFilter(e.target.value)} aria-label="Filter by intern" className="k-input sm:w-auto">
          <option value="">All active interns</option>
          {companyActiveInterns.map((i) => <option key={i.intern_id} value={i.intern_id}>{i.intern_name}</option>)}
        </select>
      </FilterBar>

      {(error || history.error) && <ErrorNote onRetry={retry}>{error || history.error}</ErrorNote>}

      <Section flush>
        {view === "active" ? (
          loading ? (
            <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
          ) : activeTasks.length === 0 ? (
            <div className="k-pad"><EmptyState icon="tasks" title="No active tasks for this company." text="Tasks the supervisors assign to these interns will show up here." /></div>
          ) : visibleTasks.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No tasks match your search/filters.</p>
          ) : (
            <DataList>
              {visibleTasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </DataList>
          )
        ) : history.loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : historyTasks.length === 0 ? (
          search.trim() || internFilter ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No tasks match your search/filters.</p>
          ) : (
            <div className="k-pad"><EmptyState icon="tasks" title="No completed tasks for this company yet." text="Finished and rated tasks move here." /></div>
          )
        ) : (
          <>
            <DataList>
              {historyTasks.map((t) => (
                <li key={t.id}><TaskHistoryRow task={t} detailBasePath="/coordinator/tasks" subLabel={t.assignees.map((a) => a.name).join(", ")} /></li>
              ))}
            </DataList>
            <LoadMore shown={historyTasks.length} total={history.total} hasMore={history.hasMore} loading={history.loadingMore} onClick={history.loadMore} />
          </>
        )}
      </Section>
    </Page>
  );
}
