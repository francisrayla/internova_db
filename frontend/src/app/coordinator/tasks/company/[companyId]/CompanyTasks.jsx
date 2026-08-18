"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import DueDateBadge from "@/components/DueDateBadge";
import TaskHistoryRow from "@/components/TaskHistoryRow";

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS = { pending: "Pending", in_progress: "Ongoing", completed: "Done" };

const PRIORITY_STYLES = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

function TaskRow({ task }) {
  return (
    <Link
      href={`/coordinator/tasks/${task.id}`}
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition hover:bg-slate-50"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
          <p className="truncate font-medium text-slate-900">{task.title}</p>
          {task.is_group && <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">Group</span>}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          {task.assignees.map((a) => a.name).join(", ")} · Assigned {task.created_at}
          {task.subtask_total > 0 ? ` · ${task.subtask_done}/${task.subtask_total} subtasks done` : ""}
        </p>
        <div className="mt-1.5"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></div>
      </div>
      {task.status === "completed" && !task.evaluation ? (
        <span className="shrink-0 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">Awaiting rating</span>
      ) : (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
      )}
    </Link>
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
  const [companies, setCompanies] = useState([]);
  const [interns, setInterns] = useState([]);
  const [view, setView] = useState("active");
  const [internFilter, setInternFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    Promise.all([fetchCoordinatorData("tasks"), fetchCoordinatorData("interns")])
      .then(([tasksRes, internsRes]) => {
        setTasks(tasksRes.tasks ?? []);
        setCompanies(tasksRes.companies ?? []);
        setInterns(internsRes.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const company = companies.find((c) => String(c.id) === String(companyId));
  const companyTasks = useMemo(() => tasks.filter((t) => String(t.company_id) === String(companyId)), [tasks, companyId]);
  const companyActiveInterns = useMemo(
    () => interns.filter((i) => String(i.company_id) === String(companyId) && i.status === "active"),
    [interns, companyId]
  );

  // A finished task still needs the supervisor's rating before it's truly
  // closed out — until then it stays visible here, not History.
  const activeTasks = useMemo(() => companyTasks.filter((t) => !(t.status === "completed" && t.evaluation)), [companyTasks]);
  const historyTasks = useMemo(() => companyTasks.filter((t) => t.status === "completed" && t.evaluation), [companyTasks]);

  const visibleTasks = useMemo(() => {
    const source = view === "active" ? activeTasks : historyTasks;
    const q = search.trim().toLowerCase();
    return source.filter((t) => {
      if (internFilter && !t.assignees.some((a) => String(a.user_id) === internFilter)) return false;
      if (view === "active" && statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.assignees.some((a) => a.name?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, historyTasks, view, internFilter, statusFilter, search]);

  return (
    <div className="space-y-6">
      <Link href="/coordinator/tasks" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        ← Back to Companies
      </Link>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{company?.company_name ?? "Company"} — Tasks</h2>
        <p className="mt-1 text-sm text-slate-600">Viewing only — supervisors assign and manage the actual work.</p>
      </div>

      <div className="flex w-fit gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          onClick={() => setView("active")}
          className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${view === "active" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Active
        </button>
        <button
          onClick={() => setView("history")}
          className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${view === "history" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          History ({historyTasks.length})
        </button>
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by intern name or task title…"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {view === "active" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">Ongoing</option>
          </select>
        )}
        <select value={internFilter} onChange={(e) => setInternFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">All active interns</option>
          {companyActiveInterns.map((i) => <option key={i.intern_id} value={i.intern_id}>{i.intern_name}</option>)}
        </select>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading tasks…</p>
        ) : view === "active" && activeTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No active tasks for this company.</p>
        ) : view === "history" && historyTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No completed tasks for this company yet.</p>
        ) : visibleTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No tasks match your search/filters.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleTasks.map((t) =>
              view === "active"
                ? <TaskRow key={t.id} task={t} />
                : <TaskHistoryRow key={t.id} task={t} detailBasePath="/coordinator/tasks" subLabel={t.assignees.map((a) => a.name).join(", ")} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
