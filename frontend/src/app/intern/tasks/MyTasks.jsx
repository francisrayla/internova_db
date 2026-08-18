"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import TaskListBoard from "@/components/TaskListBoard";
import TaskHistoryRow from "@/components/TaskHistoryRow";
import ProofUploadModal from "@/components/ProofUploadModal";

const LIVE_TYPES = ["task_evaluated", "task_comment"];

/**
 * Tasks with no subtasks yet drag directly between columns here — the same
 * motion as dragging a subtask, just one level up. Once a task has
 * subtasks, its status is derived from them, so its card stops being
 * draggable and becomes a plain link into the task, where the real board
 * lives (see TaskDetailView + SubtaskBoard). Done tasks drop out of this
 * active view entirely and live in History instead.
 */
export default function MyTasks() {
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState("active");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ownUserId, setOwnUserId] = useState(null);
  const [completingTask, setCompletingTask] = useState(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("internova_user") || "null");
      setOwnUserId(stored?.id ?? null);
    } catch {
      setOwnUserId(null);
    }
  }, []);

  function load() {
    setLoading(true);
    fetchInternData("tasks")
      .then((r) => setTasks(r.tasks ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);

  async function handleStatusChange(id, status) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      const res = await apiFetch(`/api/intern/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  function requestComplete(id) {
    const task = tasks.find((t) => t.id === id);
    if (task) setCompletingTask(task);
  }

  async function confirmComplete(files) {
    const formData = new FormData();
    files.forEach((file) => formData.append("proofs[]", file));
    const res = await apiFetch(`/api/intern/tasks/${completingTask.id}/complete`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not mark task done.");
    setCompletingTask(null);
    load();
  }

  // A finished task still needs your supervisor's rating before it's truly
  // closed out — until then it stays visible here, not History.
  const activeTasks = useMemo(() => tasks.filter((t) => !(t.status === "completed" && t.evaluation)), [tasks]);
  const historyTasks = useMemo(() => tasks.filter((t) => t.status === "completed" && t.evaluation), [tasks]);

  const visibleTasks = useMemo(() => {
    const source = view === "active" ? activeTasks : historyTasks;
    const q = search.trim().toLowerCase();
    return source.filter((t) => {
      if (view === "active" && statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeTasks, historyTasks, view, statusFilter, search]);

  function subLabelFor(task) {
    const withOthers = task.assignees.filter((a) => a.user_id !== ownUserId).map((a) => a.name);
    return [task.company_name, withOthers.length > 0 ? `with ${withOthers.join(", ")}` : null].filter(Boolean).join(" · ");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">My Tasks</h2>
        <p className="mt-1 text-sm text-slate-600">Drag a task across columns, or open one with subtasks to drag those instead.</p>
      </div>

      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
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
          placeholder="Search by task title…"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {view === "active" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">Ongoing</option>
          </select>
        )}
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading tasks…</p>
      ) : view === "active" ? (
        activeTasks.length === 0 ? (
          <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No active tasks — check History for the ones already done.</p>
        ) : visibleTasks.length === 0 ? (
          <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No tasks match your search/filters.</p>
        ) : (
          <TaskListBoard tasks={visibleTasks} detailBasePath="/intern/tasks" onStatusChange={handleStatusChange} onRequestComplete={requestComplete} subLabelFor={subLabelFor} />
        )
      ) : (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {historyTasks.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No completed tasks yet.</p>
          ) : visibleTasks.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">No tasks match your search.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleTasks.map((t) => <TaskHistoryRow key={t.id} task={t} detailBasePath="/intern/tasks" subLabel={subLabelFor(t)} />)}
            </div>
          )}
        </section>
      )}

      {completingTask && (
        <ProofUploadModal
          title={completingTask.title}
          onConfirm={confirmComplete}
          onCancel={() => setCompletingTask(null)}
        />
      )}
    </div>
  );
}
