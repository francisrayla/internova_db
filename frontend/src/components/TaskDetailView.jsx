"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/apiFetch";
import SubtaskBoard from "@/components/SubtaskBoard";
import DueDateBadge from "@/components/DueDateBadge";
import ProofUploadModal from "@/components/ProofUploadModal";
import ProofPreviewModal from "@/components/ProofPreviewModal";
import EditTaskModal from "@/components/EditTaskModal";
import NavIcon from "@/components/NavIcon";
import { Plus, X } from "lucide-react";
import { Btn, EmptyState, ErrorNote, FormField, Input, Pill, Section, Select, SheetFrame, SkeletonList, Textarea } from "@/components/dash/page";
import { isAwaitingRating } from "@/lib/taskState";
import { manilaToday } from "@/lib/dueDateUrgency";

import { inputProps } from "@/lib/inputRules";
import { useTaskLive } from "@/lib/useTaskLive";
const STATUS_TONES = { pending: "slate", in_progress: "blue", completed: "green" };
const STATUS_LABELS = { pending: "Pending", in_progress: "Ongoing", completed: "Done" };
const PRIORITY_TONES = { low: "slate", medium: "amber", high: "red" };

function StatusSelect({ value, onChange, disabled }) {
  return (
    <Select
      value={value}
      disabled={disabled}
      aria-label="Task status"
      onChange={(e) => onChange(e.target.value)}
      className="sm:w-auto"
    >
      <option value="pending">Pending</option>
      <option value="in_progress">Ongoing</option>
      <option value="completed">Done</option>
    </Select>
  );
}

function CommentThread({ comments, onSubmit, placeholder }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="k-hint">No comments yet.</p>
      ) : (
        <ul className="k-list" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} className="py-2.5 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-semibold text-slate-800">{c.author_name ?? "Unknown"}</p>
                <p className="text-xs text-slate-500">{c.created_at}</p>
              </div>
              <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700">{c.comment}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input {...inputProps("comment")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1"
        />
        <Btn type="submit" variant="primary" disabled={sending || !text.trim()} className="shrink-0">
          {sending ? "Posting…" : "Post"}
        </Btn>
      </form>
    </div>
  );
}

// Chip picker for handing a subtask to several group members at once —
// pulled from the task's own assignee list, not the whole roster. Once
// someone's picked they become a chip and drop out of the remaining
// dropdown, same pattern as the supervisor's intern picker when assigning
// the task itself.
function SubtaskAssigneePicker({ candidates, selected, onChange }) {
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

  const selectedPeople = candidates.filter((c) => selected.includes(c.user_id));
  const filtered = candidates.filter((c) => !selected.includes(c.user_id) && c.name.toLowerCase().includes(query.trim().toLowerCase()));

  function add(userId) {
    onChange([...selected, userId]);
    setQuery("");
  }
  function remove(userId) {
    onChange(selected.filter((id) => id !== userId));
  }

  return (
    <div ref={containerRef}>
      <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-[10px] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1.5 focus-within:border-[var(--ui-accent)]">
        {selectedPeople.map((p) => (
          <span key={p.user_id} className="k-pill is-info gap-1">
            {p.name}
            <button type="button" onClick={() => remove(p.user_id)} className="grid h-6 w-6 place-items-center rounded-full" aria-label={`Remove ${p.name}`}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input {...inputProps("search")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedPeople.length === 0 ? "Pick who this is for…" : "Add another…"}
          aria-label="Pick members"
          className="min-w-[120px] flex-1 border-none bg-transparent px-1 py-1 text-base outline-none sm:text-sm"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="mt-1 max-h-40 w-full overflow-y-auto rounded-[10px] border border-[var(--ui-line)] bg-[var(--ui-surface)]">
          {filtered.map((c) => (
            <button key={c.user_id} type="button" onClick={() => add(c.user_id)} className="block min-h-[44px] w-full px-3 py-2 text-left text-sm hover:bg-[var(--ui-soft)] sm:min-h-0">
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddSubtaskForm({ assignees, onAdd, noPastDue = false }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", due_date: "" });
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The supervisor cannot put a subtask due date in the past (Manila today or later).
  const today = noPastDue ? manilaToday() : undefined;
  const dueProblem = today && form.due_date && form.due_date < today ? "The due date cannot be in the past. Choose today or a later date." : "";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Enter a title.");
      return;
    }
    if (dueProblem) {
      setError(dueProblem);
      return;
    }
    if (assignees.length > 1 && assigneeIds.length === 0) {
      setError("Choose at least one member for this subtask.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAdd({ ...form, assignee_ids: assignees.length > 1 ? assigneeIds : assignees.map((a) => a.user_id) });
      setForm({ title: "", description: "", due_date: "" });
      setAssigneeIds([]);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpen(false);
    setError("");
  }

  return (
    <>
      <Btn sm onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden="true" /> Add subtask
      </Btn>
      {open && createPortal(
        <SheetFrame
          title="Add subtask"
          description="A smaller step of this task."
          onClose={saving ? undefined : close}
          onSubmit={handleSubmit}
          noValidate
          footer={
            <>
              <Btn onClick={close} disabled={saving}>Cancel</Btn>
              <Btn type="submit" variant="primary" disabled={saving}>{saving ? "Adding…" : "Add subtask"}</Btn>
            </>
          }
        >
          <div className="grid gap-4">
            <FormField label="Title" required>
              <Input {...inputProps("title")}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Subtask title"
                autoFocus
              />
            </FormField>
            <FormField label="Description (optional)">
              <Textarea {...inputProps("longText")}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </FormField>
            <FormField label="Due date (optional)" error={dueProblem}>
              <Input
                type="date"
                min={today}
                value={form.due_date}
                aria-invalid={!!dueProblem}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </FormField>
            {assignees.length > 1 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="k-label">Assign to <span className="k-req" aria-hidden="true">*</span></span>
                  <button type="button" onClick={() => setAssigneeIds(assignees.map((a) => a.user_id))} className="dash-link">
                    Select everyone
                  </button>
                </div>
                <SubtaskAssigneePicker candidates={assignees} selected={assigneeIds} onChange={setAssigneeIds} />
              </div>
            )}
            {error && error !== dueProblem && <p role="alert" className="k-note is-risk">{error}</p>}
          </div>
        </SheetFrame>,
        document.body
      )}
    </>
  );
}

function RatingForm({ onSubmit }) {
  const [rating, setRating] = useState(null);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!rating) {
      setError("Pick a score from 1 to 10.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(rating, comments.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-card">
      <h2 className="text-base font-semibold text-slate-900">Rate this task</h2>
      <p className="mt-1 text-sm text-slate-600">This task is done — score it to move it to History.</p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <span className="k-label mb-1.5 block">Score (1–10)</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`grid h-10 w-10 place-items-center rounded-xl border text-sm font-semibold transition max-sm:h-[44px] max-sm:w-[44px] ${rating === n ? "border-transparent bg-[var(--ui-btn)] text-white" : "border-[var(--ui-border)] bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <label className="k-field">
          <span className="k-label">Comments</span>
          <textarea {...inputProps("longText")}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
            placeholder="How did they do?"
            className="k-input"
          />
        </label>
        {error && <p role="alert" className="k-error">{error}</p>}
        <button type="submit" disabled={saving} className="k-btn is-primary max-sm:w-full">
          {saving ? "Saving…" : "Submit rating"}
        </button>
      </form>
    </div>
  );
}

function RatingDisplay({ evaluation }) {
  return (
    <div className="dash-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Supervisor rating</h2>
        <span className="k-pill is-ok">{evaluation.rating}/10</span>
      </div>
      {evaluation.comments && <p className="mt-2 text-sm text-slate-700">“{evaluation.comments}”</p>}
      <p className="mt-2 text-xs text-slate-500">Rated {evaluation.evaluated_at}</p>
    </div>
  );
}

const PROOF_EXT_BADGES = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  ppt: "PPT",
  pptx: "PPT",
};

function ProofGallery({ proofs, onPreview }) {
  if (!proofs || proofs.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[var(--ui-line)] pt-3">
      <p className="mb-2 text-sm font-semibold text-slate-600">Proof of completion</p>
      <div className="flex flex-wrap gap-2">
        {proofs.map((p) => {
          const isImage = p.mime_type?.startsWith("image/");
          const ext = p.file_name?.split(".").pop()?.toLowerCase();
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreview(p)}
              title={`${p.file_name} · uploaded by ${p.uploaded_by_name ?? "intern"} · ${p.created_at}`}
              className="group flex items-center gap-2 rounded-[10px] border border-[var(--ui-line)] bg-[var(--ui-soft)] p-1.5 pr-3 hover:border-[var(--ui-accent)] max-sm:min-h-[44px]"
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.file_url} alt={p.file_name} className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ui-line)] text-xs font-bold text-slate-600">
                  {PROOF_EXT_BADGES[ext] ?? "FILE"}
                </span>
              )}
              <span className="max-w-[10rem] truncate text-sm font-medium text-slate-700 group-hover:text-blue-700">{p.file_name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedSubtaskPanel({ subtask, onComment, onDelete, canManage, onPreviewProof }) {
  return (
    <div className="mt-4 border-t border-[var(--ui-line)] pt-4">
      {/* The row above already shows the title, who it is for and the due date; only what is new is shown here. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-600">Selected subtask</h3>
          {subtask.description && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{subtask.description}</p>}
        </div>
        {canManage && (
          <Btn sm variant="danger-quiet" onClick={onDelete} className="shrink-0">
            Remove subtask
          </Btn>
        )}
      </div>
      <ProofGallery proofs={subtask.proofs} onPreview={onPreviewProof} />
      <div className="mt-3 border-t border-[var(--ui-line)] pt-3">
        <CommentThread comments={subtask.comments} onSubmit={onComment} placeholder="Comment on this subtask…" />
      </div>
    </div>
  );
}

/**
 * Shared task detail body for Coordinator/Supervisor/Intern. The Trello-
 * style drag board applies to the SUBTASKS here, not the task list one
 * level up — that's where the actual granular progress happens. A task
 * with zero subtasks falls back to a plain status control for the intern,
 * since there's nothing to drag yet.
 */
export default function TaskDetailView({ fetchTask, apiBase, backHref, backLabel, resolveBackHref, canAddSubtask, canChangeStatus = false, canRate = false, canEditTask = false, requireProof = true }) {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId ?? params.id;

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSubtaskId, setSelectedSubtaskId] = useState(null);
  const [completingTarget, setCompletingTarget] = useState(null);
  const [previewProof, setPreviewProof] = useState(null);
  const [editing, setEditing] = useState(false);

  // The first load shows the skeleton; reloads after an action (done, comment, edit) refresh the data quietly,
  // so the page keeps its content and scroll position.
  function load(quiet = false) {
    if (!quiet) setLoading(true);
    fetchTask(taskId)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [taskId]);
  // Someone else moved a subtask, finished, commented or rated: show it without a refresh.
  useTaskLive((ids) => {
    if (ids.has(Number(taskId))) load(true);
  });

  async function updateTaskStatus(status) {
    // Marking done needs proof first — open the modal instead of PATCHing
    // directly (the backend rejects a direct "completed" here anyway).
    // Schools without the Attachments feature skip the modal entirely and
    // complete straight away, since there's nothing to attach.
    if (status === "completed") {
      if (requireProof) {
        setCompletingTarget({ type: "task", id: taskId, title: task.title });
      } else {
        completeWithoutProof("task", taskId);
      }
      return;
    }
    setTask((t) => ({ ...t, status }));
    await apiFetch(`${apiBase}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function updateSubtaskStatus(subtaskId, status) {
    if (status === "completed") {
      const subtask = task.subtasks.find((s) => s.id === subtaskId);
      if (!subtask) return;
      if (requireProof) {
        setCompletingTarget({ type: "subtask", id: subtaskId, title: subtask.title });
      } else {
        completeWithoutProof("subtask", subtaskId);
      }
      return;
    }
    setTask((t) => ({ ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskId ? { ...s, status } : s)) }));
    try {
      const res = await apiFetch(`${apiBase}/subtasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      load(true);
    } catch (err) {
      setError(err.message);
      load(true);
    }
  }

  async function confirmComplete(files) {
    const { type, id } = completingTarget;
    const formData = new FormData();
    files.forEach((file) => formData.append("proofs[]", file));
    const endpoint = type === "task" ? `${apiBase}/tasks/${id}/complete` : `${apiBase}/subtasks/${id}/complete`;
    const res = await apiFetch(endpoint, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not mark this as done.");
    setCompletingTarget(null);
    load(true);
  }

  async function completeWithoutProof(type, id) {
    const endpoint = type === "task" ? `${apiBase}/tasks/${id}/complete` : `${apiBase}/subtasks/${id}/complete`;
    try {
      const res = await apiFetch(endpoint, { method: "POST", body: new FormData() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not mark this as done.");
      load(true);
    } catch (err) {
      setError(err.message);
      load(true);
    }
  }

  async function addTaskComment(text) {
    const res = await apiFetch(`${apiBase}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message);
    load(true);
  }

  async function addSubtaskComment(subtaskId, text) {
    const res = await apiFetch(`${apiBase}/subtasks/${subtaskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message);
    load(true);
  }

  async function addSubtask(form) {
    const res = await apiFetch(`${apiBase}/tasks/${taskId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not add subtask.");
    load(true);
  }

  async function deleteSubtask(subtaskId) {
    const res = await apiFetch(`${apiBase}/subtasks/${subtaskId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.message || "Could not remove subtask.");
      return;
    }
    setSelectedSubtaskId(null);
    load(true);
  }

  async function submitRating(rating, comments) {
    const res = await apiFetch(`${apiBase}/tasks/${taskId}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comments }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not save rating.");
    // Back to the list, not the just-rated task — a supervisor rating
    // several tasks in one sitting needs to land on the next one to rate,
    // not linger on the one they just finished.
    router.push(resolvedBackHref);
  }

  const selectedSubtask = task?.subtasks.find((s) => s.id === selectedSubtaskId) ?? null;
  const resolvedBackHref = (task && resolveBackHref?.(task)) || backHref;
  // canAddSubtask is a plain boolean for coordinator/supervisor (fixed per
  // role) but a per-task function for the intern — a group task only lets
  // its designated leader add subtasks, a solo task lets its owner.
  const canManageSubtasks = task ? (typeof canAddSubtask === "function" ? canAddSubtask(task) : canAddSubtask) : false;

  return (
    <div className="k-page">
      <Link href={resolvedBackHref} className="k-back justify-self-start">
        <NavIcon name="back" size={16} />{backLabel}
      </Link>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={2} height="h-28" />
      ) : !task ? (
        <EmptyState icon="tasks" title="Task not found" text="It may have been removed. Go back to the list and open another task." />
      ) : (
        <>
          <div className="dash-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {task.priority && <Pill tone={PRIORITY_TONES[task.priority] ?? "slate"} className="capitalize">{task.priority}</Pill>}
                  <h1 className="break-words text-xl font-semibold text-slate-900">{task.title}</h1>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {task.company_name ?? ""}{task.assigned_by_name ? ` · Assigned by ${task.assigned_by_name}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {task.is_group ? "Group task with " : "Assigned to "}
                  <span className="font-medium text-slate-700">{task.assignees.map((a) => a.name).join(", ")}</span>
                </p>
                {task.is_group && task.leader_id && (
                  <p className="mt-1 text-sm text-slate-500">
                    Leader: <span className="font-medium text-slate-700">{task.assignees.find((a) => a.user_id === task.leader_id)?.name ?? "—"}</span>
                    {task.is_leader && <Pill tone="blue" size="sm" className="ml-1.5">You</Pill>}
                    {task.leader_problem === "inactive" && <Pill tone="amber" size="sm" className="ml-1.5">Inactive</Pill>}
                  </p>
                )}
                <div className="mt-2"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={STATUS_TONES[task.status] ?? "slate"} className="shrink-0 whitespace-nowrap capitalize">{STATUS_LABELS[task.status] ?? task.status}</Pill>
                {canChangeStatus && task.subtask_total === 0 && canManageSubtasks && <StatusSelect value={task.status} onChange={updateTaskStatus} />}
                {canEditTask && task.can_edit !== false && (
                  <Btn sm onClick={() => setEditing(true)}>
                    Edit task
                  </Btn>
                )}
              </div>
            </div>
            {/* A group task only moves on through its leader: without an active one nobody can submit it. */}
            {canEditTask && task.leader_problem && task.can_edit !== false && (
              <div className="k-note is-warn mt-3 flex-wrap items-center justify-between gap-3" role="alert">
                <span className="min-w-0">
                  {task.leader_problem === "inactive"
                    ? "The task leader's account is no longer active, so nobody can submit this task. Choose a new task leader."
                    : "This group task has no leader, so nobody can submit it. Choose a task leader."}
                </span>
                <Btn sm variant="primary" onClick={() => setEditing(true)} className="max-sm:w-full max-sm:min-h-[44px]">Choose a new task leader</Btn>
              </div>
            )}
            {task.description &&<p className="mt-4 text-sm text-slate-600">{task.description}</p>}

            {task.subtask_total > 0 && task.subtask_done < task.subtask_total && task.status !== "completed" && (
              canManageSubtasks && canChangeStatus ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ui-info-bg)] px-4 py-3 text-sm text-[var(--ui-info)]">
                  <p className="min-w-0 text-sm">Finish all subtasks first ({task.subtask_done}/{task.subtask_total} done).</p>
                  <button
                    type="button"
                    disabled
                    title={`Finish all subtasks first (${task.subtask_done}/${task.subtask_total} done)`}
                    className="k-btn is-secondary shrink-0 max-sm:w-full"
                  >
                    Mark task complete
                  </button>
                </div>
              ) : (
                <p className="k-hint mt-3">Status is driven by its subtasks below ({task.subtask_done}/{task.subtask_total} done).</p>
              )
            )}

            {task.subtask_total > 0 && task.subtask_done < task.subtask_total && task.status === "completed" && (
              <p className="k-note is-warn mt-3">
                This task is marked done, but {task.subtask_total - task.subtask_done} of its {task.subtask_total} subtask{task.subtask_total === 1 ? " is" : "s are"} not done ({task.subtask_done}/{task.subtask_total} done).
                {canChangeStatus ? " Set each unfinished subtask to Done." : canAddSubtask === true ? " Remove the unfinished subtasks, or ask the intern to finish them." : ""}
              </p>
            )}

            {task.subtask_total > 0 && task.subtask_done === task.subtask_total && task.status !== "completed" && (
              canManageSubtasks ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ui-info-bg)] px-4 py-3 text-sm text-[var(--ui-info)]">
                  <p className="min-w-0 text-sm font-medium">Every subtask is done — mark the whole task complete to send it for the supervisor&apos;s rating.</p>
                  <button
                    type="button"
                    onClick={() => (requireProof ? setCompletingTarget({ type: "task", id: taskId, title: task.title }) : completeWithoutProof("task", taskId))}
                    className="k-btn is-primary shrink-0 max-sm:w-full"
                  >
                    Mark task complete
                  </button>
                </div>
              ) : (
                <p className="k-note mt-3">
                  Every subtask is done — waiting for the task leader to mark the whole task complete.
                </p>
              )
            )}

            {task.subtask_total === 0 && task.is_group && !task.is_leader && canChangeStatus && (
              <p className="k-hint mt-3">Only the task leader can update this task&apos;s status directly.</p>
            )}

            <ProofGallery proofs={task.proofs} onPreview={setPreviewProof} />

            <div className="mt-5 border-t border-[var(--ui-line)] pt-5">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Comments</h2>
              <CommentThread comments={task.comments} onSubmit={addTaskComment} placeholder="Comment on this task…" />
            </div>
          </div>

          {task.evaluation ? (
            <RatingDisplay evaluation={task.evaluation} />
          ) : task.status === "completed" && canRate ? (
            task.subtask_done === task.subtask_total ? (
              <RatingForm onSubmit={submitRating} />
            ) : (
              <p className="k-note">
                This task can be rated once every subtask is done ({task.subtask_done}/{task.subtask_total} done).
              </p>
            )
          ) : isAwaitingRating(task) ? (
            <p className="k-note">
              Waiting on the supervisor rating before this moves to History.
            </p>
          ) : null}

          <Section
            title="Subtasks"
            action={canManageSubtasks && task.status !== "completed" ? <AddSubtaskForm assignees={task.assignees} onAdd={addSubtask} noPastDue={apiBase.includes("/supervisor")} /> : undefined}
          >
            {canManageSubtasks && task.status === "completed" && (
              <p className="k-hint mb-3">
                {task.evaluation ? "This task has been rated, so no more subtasks can be added." : "This task is done, so no more subtasks can be added. A done task needs all of its subtasks done."}
              </p>
            )}
            {task.subtasks.length === 0 ? (
              <p className="k-hint py-2">No subtasks yet.</p>
            ) : (
              <SubtaskBoard
                subtasks={task.subtasks}
                onStatusChange={updateSubtaskStatus}
                onRequestComplete={(id) => updateSubtaskStatus(id, "completed")}
                onSelect={(id) => setSelectedSubtaskId((cur) => (cur === id ? null : id))}
                selectedId={selectedSubtaskId}
                interactive={canChangeStatus}
                taskCompleted={task.status === "completed"}
              />
            )}
            {selectedSubtask && (
              <SelectedSubtaskPanel
                subtask={selectedSubtask}
                onComment={(text) => addSubtaskComment(selectedSubtask.id, text)}
                onDelete={() => deleteSubtask(selectedSubtask.id)}
                onPreviewProof={setPreviewProof}
                canManage={typeof canAddSubtask !== "function" && canManageSubtasks}
              />
            )}
          </Section>
        </>
      )}

      {completingTarget && (
        <ProofUploadModal
          title={completingTarget.title}
          onConfirm={confirmComplete}
          onCancel={() => setCompletingTarget(null)}
        />
      )}

      {previewProof && <ProofPreviewModal proof={previewProof} onClose={() => setPreviewProof(null)} />}

      {editing && task && (
        <EditTaskModal task={task} apiBase={apiBase} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(true); }} />
      )}
    </div>
  );
}
