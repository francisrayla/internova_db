"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";
import DueDateBadge from "@/components/DueDateBadge";
import TaskHistoryRow from "@/components/TaskHistoryRow";
import NavIcon from "@/components/NavIcon";
import { isAwaitingRating } from "@/lib/taskState";
import { useTaskHistory } from "@/lib/useTaskHistory";
import { LoadMore } from "@/components/Pagination";
import { manilaToday } from "@/lib/dueDateUrgency";

import { inputProps } from "@/lib/inputRules";
import { Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, FormField, Input, Page, PageHeader, SearchField, Section, Select, SheetFrame, TabStrip, Textarea } from "@/components/dash/page";
import { useTaskLive } from "@/lib/useTaskLive";

const STATUS_TONES = {
  pending: "slate",
  in_progress: "blue",
  completed: "green",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "Ongoing",
  completed: "Done",
};

const PRIORITY_TONES = {
  low: "slate",
  medium: "amber",
  high: "red",
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
      <div className="k-input flex flex-wrap items-center gap-1.5 !py-1.5 focus-within:border-[var(--ui-accent)] focus-within:shadow-[0_0_0_3px_var(--ui-ring)]">
        {selectedInterns.map((i) => (
          <span key={i.deployment_id} className="k-pill is-info max-w-full items-center gap-1 !py-1 pr-1">
            <span className="min-w-0 break-words">{i.name}</span>
            <button
              type="button"
              onClick={() => remove(i.deployment_id)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-black/10 max-sm:-my-2 max-sm:h-11 max-sm:w-9"
              aria-label={`Remove ${i.name}`}
            >
              <NavIcon name="close" size={13} />
            </button>
          </span>
        ))}
        <input {...inputProps("search")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedInterns.length === 0 ? "Search interns…" : "Add another…"}
          aria-label="Search interns to add"
          className="min-h-[30px] min-w-[110px] flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-slate-900 outline-none focus:shadow-none max-sm:min-h-[36px] max-sm:text-base"
        />
      </div>
      {open && (
        <div className="k-pop absolute z-10 mt-1 max-h-48 w-full overflow-y-auto p-1">
          {interns.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No interns are deployed at your company yet.</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">{selectedInterns.length === interns.length ? "All interns selected." : "No matches."}</p>
          ) : (
            filtered.map((i) => (
              <button
                key={i.deployment_id}
                type="button"
                disabled={!!i.starts_on}
                onClick={() => add(i.deployment_id)}
                className="k-menuitem justify-between gap-2 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 break-words">{i.name}</span>
                {i.starts_on && <Pill size="sm" className="shrink-0">Starts {i.starts_on_label}</Pill>}
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
  const today = manilaToday();
  const dueProblem = form.due_date && form.due_date < today ? "The due date cannot be in the past. Choose today or a later date." : "";

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
    if (dueProblem) {
      setError(dueProblem);
      return;
    }
    if (selected.length > 1 && !leaderId) {
      setError("Choose a task leader. With more than one intern, the leader submits the task once the subtasks are done.");
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
      if (!res.ok || !data.success) throw new Error((data.errors ? Object.values(data.errors).flat()[0] : null) || data.message || "Could not assign task.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      title="Assign a task"
      description="Check one intern for an individual task, or several for a group task."
      onClose={onClose}
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving || !!dueProblem}>
            {saving ? "Assigning…" : selected.length > 1 ? `Assign to ${selected.length} interns` : "Assign task"}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="k-field">
          <span className="k-label">Interns</span>
          <InternPicker interns={interns} selected={selected} onChange={updateSelected} />
        </div>
        {selectedInterns.length > 1 && (
          <FormField
            label="Task leader"
            required
            hint="Required for a group task. The leader splits the task into subtasks for the group and is the one who submits the task once every subtask is done."
          >
            <Select required value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
              <option value="">Choose the leader…</option>
              {selectedInterns.map((i) => <option key={i.user_id} value={i.user_id}>{i.name}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label="Title">
          <Input {...inputProps("title")} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Prepare weekly report" />
        </FormField>
        <FormField label="Description">
          <Textarea {...inputProps("longText")} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
        </FormField>
        <div className="grid grid-cols-1 items-start gap-3 min-[420px]:grid-cols-2">
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </FormField>
          <FormField label="Due date" error={dueProblem} hint={!dueProblem ? "Today or later." : undefined}>
            <Input type="date" min={today} value={form.due_date} aria-invalid={!!dueProblem} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
          </FormField>
        </div>
        {error && <Banner tone="red">{error}</Banner>}
      </div>
    </SheetFrame>
  );
}

function TaskRow({ task }) {
  const leaderName = task.leader_id ? task.assignees.find((a) => a.user_id === task.leader_id)?.name : null;
  const awaiting = isAwaitingRating(task);

  return (
    <li className={`border-l-4 ${awaiting ? "border-l-amber-500" : "border-l-transparent"}`}>
      <Link href={`/supervisor/tasks/${task.id}`} className="k-row is-wrap flex-wrap">
        <span className="k-row-main min-w-[16rem]">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill tone={PRIORITY_TONES[task.priority] ?? "slate"} size="sm" className="shrink-0 capitalize">{task.priority}</Pill>
            <span className="min-w-0 break-words font-medium text-slate-900">{task.title}</span>
            {task.is_group && <Pill size="sm" className="shrink-0">Group</Pill>}
          </span>
          <span className="mt-1.5 block text-xs text-slate-500">
            {task.assignees.map((a) => a.name).join(", ")} · Assigned {task.created_at}
            {leaderName ? ` · Leader: ${leaderName}` : ""}
            {task.subtask_total > 0 ? ` · ${task.subtask_done}/${task.subtask_total} subtasks done` : ""}
          </span>
          <span className="mt-1.5 block"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></span>
        </span>
        <span className="k-row-side">
          {awaiting ? (
            <Pill tone="amber" className="gap-1">Needs your rating <NavIcon name="arrow" size={13} /></Pill>
          ) : (
            <Pill tone={STATUS_TONES[task.status] ?? "slate"}>{STATUS_LABELS[task.status]}</Pill>
          )}
        </span>
      </Link>
    </li>
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
  const [counts, setCounts] = useState({ active: 0, history: 0, awaiting_rating: 0 });
  const [reloads, setReloads] = useState(0);
  const [interns, setInterns] = useState([]);
  const [notSetUp, setNotSetUp] = useState([]);
  const [view, setView] = useState("active");
  const [internFilter, setInternFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  // quiet: a live update refreshes the list without the skeleton
  function load(quiet = false) {
    if (quiet !== true) setLoading(true);
    setReloads((n) => n + 1);
    // Active = open work plus done tasks still waiting for a rating (all of it); History is fetched a page at a time below.
    fetchSupervisorData("tasks?view=active")
      .then((r) => {
        setTasks(r.tasks ?? []);
        setCounts(r.counts ?? { active: (r.tasks ?? []).length, history: 0, awaiting_rating: 0 });
        setInterns(r.interns ?? []);
        setNotSetUp(r.not_set_up ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useTaskLive(() => load(true));

  // A finished task still needs your rating before it's truly closed out —
  // until then it stays visible here, not History.
  const activeTasks = tasks;
  const awaitingCount = counts.awaiting_rating ?? 0;

  const history = useTaskHistory({
    fetcher: (qs) => fetchSupervisorData(`tasks?${qs}`),
    enabled: view === "history",
    search,
    filters: { deployment_id: internFilter },
    refreshKey: reloads,
  });
  const historyTasks = history.items;

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeTasks.filter((t) => {
      if (internFilter && !t.assignees.some((a) => String(a.deployment_id) === internFilter)) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.assignees.some((a) => a.name?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, internFilter, statusFilter, search]);

  return (
    <Page>
      <PageHeader title="Tasks" sentence="Assign work to the interns at your company — individually or as a group.">
        <Btn variant="primary" onClick={() => setShowModal(true)} disabled={interns.length === 0}>
          Assign task
        </Btn>
      </PageHeader>

      {notSetUp.length > 0 && (
        <div className="k-note is-warn">
          <span className="min-w-0">
            {notSetUp.join(", ")} {notSetUp.length === 1 ? "has" : "have"} not set up an account yet, so they are left out of task assignment until
            they open their invitation. The coordinator can fix the email and resend the link.
          </span>
        </div>
      )}

      <TabStrip
        label="Task list"
        active={view}
        onChange={setView}
        tabs={[
          { key: "active", label: `Active${awaitingCount > 0 ? ` · ${awaitingCount} to rate` : ""}` },
          { key: "history", label: `History (${counts.history})` },
        ]}
      />

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by task title or intern name…"
          aria-label="Search tasks"
        />
        {view === "active" && (
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">Ongoing</option>
          </Select>
        )}
        <Select value={internFilter} onChange={(e) => setInternFilter(e.target.value)} aria-label="Filter by intern">
          <option value="">All interns</option>
          {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
        </Select>
      </FilterBar>

      {(error || history.error) && <ErrorNote>{error || history.error}</ErrorNote>}

      <Section flush>
        {view === "active" ? (
          loading ? (
            <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
          ) : activeTasks.length === 0 && error ? null : activeTasks.length === 0 ? (
            <div className="k-pad"><EmptyState icon="tasks" title="No active tasks" text="Check History for the ones already done." /></div>
          ) : visibleTasks.length === 0 ? (
            <div className="k-pad"><EmptyState icon="search" title="No matches" text="No tasks match your search/filters." /></div>
          ) : (
            <ul className="k-list">
              {visibleTasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </ul>
          )
        ) : history.loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : historyTasks.length === 0 && history.error ? null : historyTasks.length === 0 ? (
          search.trim() || internFilter ? (
            <div className="k-pad"><EmptyState icon="search" title="No matches" text="No tasks match your search/filters." /></div>
          ) : (
            <div className="k-pad"><EmptyState icon="tasks" title="No completed tasks yet" text="Tasks you have rated will be kept here." /></div>
          )
        ) : (
          <>
            <ul className="k-list">
              {historyTasks.map((t) => (
                <li key={t.id}><TaskHistoryRow task={t} detailBasePath="/supervisor/tasks" subLabel={t.assignees.map((a) => a.name).join(", ")} /></li>
              ))}
            </ul>
            <LoadMore shown={historyTasks.length} total={history.total} hasMore={history.hasMore} loading={history.loadingMore} onClick={history.loadMore} />
          </>
        )}
      </Section>

      {showModal && (
        <AssignTaskModal interns={interns} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </Page>
  );
}
