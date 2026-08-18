"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";
import DueDateBadge from "@/components/DueDateBadge";
import TaskHistoryRow from "@/components/TaskHistoryRow";

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "Ongoing",
  completed: "Done",
};

const PRIORITY_STYLES = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

/**
 * A search-and-select dropdown instead of a plain checkbox list — a
 * supervisor with a dozen+ interns shouldn't have to scroll a giant list
 * every time. Typing filters, clicking adds a chip, and picking several
 * chips is exactly how a group task gets assembled.
 */
function InternPicker({ interns, selected, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedInterns = interns.filter((i) => selected.includes(i.deployment_id));
  const filtered = interns.filter((i) => !selected.includes(i.deployment_id) && i.name.toLowerCase().includes(query.trim().toLowerCase()));

  function add(deploymentId) {
    onChange([...selected, deploymentId]);
    setQuery("");
  }

  function remove(deploymentId) {
    onChange(selected.filter((id) => id !== deploymentId));
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 p-2 focus-within:border-blue-500">
        {selectedInterns.map((i) => (
          <span key={i.deployment_id} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
            {i.name}
            <button type="button" onClick={() => remove(i.deployment_id)} className="text-blue-500 hover:text-blue-800" aria-label={`Remove ${i.name}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedInterns.length === 0 ? "Search interns…" : "Add another…"}
          className="min-w-[100px] flex-1 border-none px-1 py-0.5 text-sm outline-none"
        />
      </div>
      {open && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {interns.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No interns assigned to you yet.</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">{selectedInterns.length === interns.length ? "All interns selected." : "No matches."}</p>
          ) : (
            filtered.map((i) => (
              <button key={i.deployment_id} type="button" onClick={() => add(i.deployment_id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                {i.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AssignTaskModal({ interns, onClose, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [leaderId, setLeaderId] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedInterns = interns.filter((i) => selected.includes(i.deployment_id));

  function updateSelected(next) {
    setSelected(next);
    // Drop the leader pick once the group shrinks to one person (no longer
    // a group task) or once that intern is removed from the selection.
    const stillEligible = next.length > 1 && next.some((id) => String(interns.find((i) => i.deployment_id === id)?.user_id) === String(leaderId));
    if (!stillEligible) setLeaderId("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (selected.length === 0) {
      setError("Select at least one intern.");
      return;
    }
    if (!form.title.trim()) {
      setError("Enter a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/supervisor/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, deployment_ids: selected, leader_id: leaderId || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not assign task.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Assign a task</h3>
        <p className="mt-1 text-xs text-slate-500">Check one intern for an individual task, or several for a group task.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Interns</span>
            <InternPicker interns={interns} selected={selected} onChange={updateSelected} />
          </div>
          {selectedInterns.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Group leader (optional)</span>
              <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                <option value="">No leader — everyone works equally</option>
                {selectedInterns.map((i) => <option key={i.user_id} value={i.user_id}>{i.name}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-400">The leader can break this task into subtasks and assign them to the rest of the group.</span>
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Title</span>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. Prepare weekly report" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Description</span>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Priority</span>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Due date</span>
              <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Assigning…" : selected.length > 1 ? `Assign to ${selected.length} interns` : "Assign task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskRow({ task }) {
  const leaderName = task.leader_id ? task.assignees.find((a) => a.user_id === task.leader_id)?.name : null;

  return (
    <Link
      href={`/supervisor/tasks/${task.id}`}
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
          {leaderName ? ` · Leader: ${leaderName}` : ""}
          {task.subtask_total > 0 ? ` · ${task.subtask_done}/${task.subtask_total} subtasks done` : ""}
        </p>
        <div className="mt-1.5"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></div>
      </div>
      {task.status === "completed" && !task.evaluation ? (
        <span className="shrink-0 rounded-full bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white">Rate now →</span>
      ) : (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
      )}
    </Link>
  );
}

/**
 * The supervisor is the one who actually assigns work — checking one intern
 * makes it individual, checking several makes it a group task. Status
 * itself is never edited here: once assigned, the intern drags subtasks
 * inside the task to report their own progress.
 */
export default function TaskManagement() {
  const [tasks, setTasks] = useState([]);
  const [interns, setInterns] = useState([]);
  const [view, setView] = useState("active");
  const [internFilter, setInternFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  function load() {
    setLoading(true);
    fetchSupervisorData("tasks")
      .then((r) => {
        setTasks(r.tasks ?? []);
        setInterns(r.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // A finished task still needs your rating before it's truly closed out —
  // until then it stays visible here, not History.
  const activeTasks = useMemo(() => tasks.filter((t) => !(t.status === "completed" && t.evaluation)), [tasks]);
  const historyTasks = useMemo(() => tasks.filter((t) => t.status === "completed" && t.evaluation), [tasks]);

  const visibleTasks = useMemo(() => {
    const source = view === "active" ? activeTasks : historyTasks;
    const q = search.trim().toLowerCase();
    return source.filter((t) => {
      if (internFilter && !t.assignees.some((a) => String(a.deployment_id) === internFilter)) return false;
      if (view === "active" && statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.assignees.some((a) => a.name?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, historyTasks, view, internFilter, statusFilter, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
          <p className="mt-1 text-sm text-slate-600">Assign work to the interns you supervise — individually or as a group.</p>
        </div>
        <button onClick={() => setShowModal(true)} disabled={interns.length === 0} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          Assign task
        </button>
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
          placeholder="Search by task title or intern name…"
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
          <option value="">All interns</option>
          {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
        </select>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading tasks…</p>
        ) : view === "active" && activeTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No active tasks — check History for the ones already done.</p>
        ) : view === "history" && historyTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No completed tasks yet.</p>
        ) : visibleTasks.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No tasks match your search/filters.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleTasks.map((t) =>
              view === "active"
                ? <TaskRow key={t.id} task={t} />
                : <TaskHistoryRow key={t.id} task={t} detailBasePath="/supervisor/tasks" subLabel={t.assignees.map((a) => a.name).join(", ")} />
            )}
          </div>
        )}
      </section>

      {showModal && (
        <AssignTaskModal interns={interns} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}
