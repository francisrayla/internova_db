"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import TaskListBoard from "@/components/TaskListBoard";
import TaskHistoryRow from "@/components/TaskHistoryRow";
import ProofUploadModal from "@/components/ProofUploadModal";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";
import { useTaskHistory } from "@/lib/useTaskHistory";
import { LoadMore } from "@/components/Pagination";
import { EmptyState, ErrorNote, FilterBar, Page, PageHeader, SearchField, Section, Select, SkeletonList, TabStrip } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
import { useTaskLive } from "@/lib/useTaskLive";
const LIVE_TYPES = ["task_evaluated", "task_comment", "task_updated"];

/**
 * Tasks with no subtasks yet drag directly between columns here — the same
 * motion as dragging a subtask, just one level up. Once a task has
 * subtasks, its status is derived from them, so its card stops being
 * draggable and becomes a plain link into the task, where the real board
 * lives (see TaskDetailView + SubtaskBoard). Done tasks drop out of this
 * active view entirely and live in History instead.
 */
export default function MyTasks() {
  const { user } = useCurrentUser();
  const requireProof = hasPlanFeature(user, PLAN_FEATURES.ATTACHMENTS);
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ active: 0, history: 0 });
  const [reloads, setReloads] = useState(0);
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

  // Active = open work plus done tasks still waiting for a rating (all of it); History is fetched a page at a time below.
  // quiet: a live update refreshes the board without the skeleton
  function load(quiet = false) {
    if (quiet !== true) setLoading(true);
    setReloads((n) => n + 1);
    fetchInternData("tasks?view=active")
      .then((r) => {
        setTasks(r.tasks ?? []);
        setCounts(r.counts ?? { active: (r.tasks ?? []).length, history: 0 });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);
  useTaskLive(() => load(true));

  async function handleStatusChange(id, status) {
    setError("");
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
    if (!task) return;
    if (requireProof) {
      setCompletingTask(task);
    } else {
      completeDirectly(id);
    }
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

  async function completeDirectly(id) {
    setError("");
    try {
      const res = await apiFetch(`/api/intern/tasks/${id}/complete`, { method: "POST", body: new FormData() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not mark task done.");
      load();
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  const history = useTaskHistory({
    fetcher: (qs) => fetchInternData(`tasks?${qs}`),
    enabled: view === "history",
    search,
    refreshKey: reloads,
  });
  const historyTasks = history.items;

  // A finished task still needs your supervisor's rating before it's truly
  // closed out — until then it stays visible here, not History.
  const activeTasks = tasks;

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeTasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeTasks, statusFilter, search]);

  function subLabelFor(task) {
    const withOthers = task.assignees.filter((a) => a.user_id !== ownUserId).map((a) => a.name);
    return [task.company_name, withOthers.length > 0 ? `with ${withOthers.join(", ")}` : null].filter(Boolean).join(" · ");
  }

  return (
    <Page>
      <PageHeader title="My tasks" sentence="Press and hold a task to move it between Pending, Ongoing and Done, or open it to see its subtasks." />

      <TabStrip
        label="Task view"
        active={view}
        onChange={setView}
        tabs={[
          { key: "active", label: "Active" },
          { key: "history", label: "History", count: counts.history },
        ]}
      />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by task title…"
        />
        {view === "active" && (
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">Ongoing</option>
          </Select>
        )}
      </FilterBar>

      {(error || history.error) && <ErrorNote>{error || history.error}</ErrorNote>}

      {view === "active" ? (
        loading ? (
          <SkeletonList rows={3} height="h-24" />
        ) : activeTasks.length === 0 ? (
          <EmptyState icon="tasks" title="No active tasks" text="Check History for the ones already done." />
        ) : visibleTasks.length === 0 ? (
          <EmptyState icon="search" title="No tasks match" text="Try a different search or status." />
        ) : (
          <TaskListBoard tasks={visibleTasks} detailBasePath="/intern/tasks" onStatusChange={handleStatusChange} onRequestComplete={requestComplete} subLabelFor={subLabelFor} />
        )
      ) : history.loading ? (
        <SkeletonList rows={3} height="h-24" />
      ) : historyTasks.length === 0 ? (
        search.trim() ? (
          <EmptyState icon="search" title="No tasks match" text="Try a different search." />
        ) : (
          <EmptyState icon="tasks" title="No completed tasks yet" text="Tasks your supervisor has rated show up here." />
        )
      ) : (
        <Section flush>
          <div className="divide-y divide-slate-100">
            {historyTasks.map((t) => <TaskHistoryRow key={t.id} task={t} detailBasePath="/intern/tasks" subLabel={subLabelFor(t)} />)}
          </div>
          <LoadMore shown={historyTasks.length} total={history.total} hasMore={history.hasMore} loading={history.loadingMore} onClick={history.loadMore} />
        </Section>
      )}

      {completingTask && (
        <ProofUploadModal
          title={completingTask.title}
          onConfirm={confirmComplete}
          onCancel={() => setCompletingTask(null)}
        />
      )}
    </Page>
  );
}
