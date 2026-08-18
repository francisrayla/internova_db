"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import SubtaskBoard from "@/components/SubtaskBoard";
import DueDateBadge from "@/components/DueDateBadge";
import ProofUploadModal from "@/components/ProofUploadModal";
import ProofPreviewModal from "@/components/ProofPreviewModal";

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const PRIORITY_STYLES = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
    >
      <option value="pending">Pending</option>
      <option value="in_progress">Ongoing</option>
      <option value="completed">Done</option>
    </select>
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
        <p className="text-xs text-slate-400">No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">{c.author_name ?? "Unknown"}</p>
                <p className="text-[11px] text-slate-400">{c.created_at}</p>
              </div>
              <p className="mt-0.5 text-sm text-slate-700">{c.comment}</p>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button type="submit" disabled={sending || !text.trim()} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          {sending ? "…" : "Post"}
        </button>
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
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 p-1.5 focus-within:border-blue-500">
        {selectedPeople.map((p) => (
          <span key={p.user_id} className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {p.name}
            <button type="button" onClick={() => remove(p.user_id)} className="text-blue-500 hover:text-blue-800" aria-label={`Remove ${p.name}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedPeople.length === 0 ? "Whole group (or pick people)…" : "Add another…"}
          className="min-w-[100px] flex-1 border-none px-1 py-0.5 text-xs outline-none"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.map((c) => (
            <button key={c.user_id} type="button" onClick={() => add(c.user_id)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50">
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddSubtaskForm({ assignees, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", due_date: "" });
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Enter a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAdd({ ...form, assignee_ids: assigneeIds });
      setForm({ title: "", description: "", due_date: "" });
      setAssigneeIds([]);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600">
        + Add subtask
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <input
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="Subtask title"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
        autoFocus
      />
      <textarea
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Description (optional)"
        rows={2}
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
      />
      <input
        type="date"
        value={form.due_date}
        onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
      />
      {assignees.length > 1 && (
        <div>
          <span className="mb-1 block text-[11px] font-semibold text-slate-500">Assign to (leave blank for the whole group)</span>
          <SubtaskAssigneePicker candidates={assignees} selected={assigneeIds} onChange={setAssigneeIds} />
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white">
          Cancel
        </button>
      </div>
    </form>
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
    <div className="rounded-3xl border border-purple-200 bg-purple-50/60 p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-purple-900">Rate this task</h2>
      <p className="mt-1 text-xs text-purple-700">This task is done — score it to move it to History.</p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-purple-900">Score (1–10)</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`h-9 w-9 rounded-xl text-sm font-semibold transition ${rating === n ? "bg-purple-600 text-white" : "bg-white text-slate-600 hover:bg-purple-100"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-xs">
          <span className="mb-1.5 block font-semibold text-purple-900">Comments</span>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
            placeholder="How did they do?"
            className="w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500"
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={saving} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60">
          {saving ? "Saving…" : "Submit rating"}
        </button>
      </form>
    </div>
  );
}

function RatingDisplay({ evaluation }) {
  return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-emerald-900">Supervisor rating</h2>
        <span className="rounded-full bg-emerald-600 px-3 py-1 text-sm font-bold text-white">{evaluation.rating}/10</span>
      </div>
      {evaluation.comments && <p className="mt-2 text-sm text-emerald-800">“{evaluation.comments}”</p>}
      <p className="mt-2 text-xs text-emerald-600">Rated {evaluation.evaluated_at}</p>
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
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-2 text-xs font-semibold text-slate-500">Proof of completion</p>
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
              className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 pr-3 hover:border-blue-300 hover:bg-blue-50"
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.file_url} alt={p.file_name} className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200 text-[10px] font-bold text-slate-500">
                  {PROOF_EXT_BADGES[ext] ?? "FILE"}
                </span>
              )}
              <span className="max-w-[10rem] truncate text-xs font-medium text-slate-600 group-hover:text-blue-700">{p.file_name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedSubtaskPanel({ subtask, onComment, onDelete, canManage, onPreviewProof }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">{subtask.title}</p>
          {subtask.description && <p className="mt-1 text-sm text-slate-600">{subtask.description}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <p className="text-xs text-slate-500">{subtask.assignees?.length > 0 ? subtask.assignees.map((a) => a.name).join(", ") : "Unassigned"}</p>
            <DueDateBadge dueDateRaw={subtask.due_date_raw} status={subtask.status} />
          </div>
        </div>
        {canManage && (
          <button onClick={onDelete} className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
            Remove
          </button>
        )}
      </div>
      <ProofGallery proofs={subtask.proofs} onPreview={onPreviewProof} />
      <div className="mt-3 border-t border-blue-100 pt-3">
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
export default function TaskDetailView({ fetchTask, apiBase, backHref, backLabel, resolveBackHref, canAddSubtask, canChangeStatus = false, canRate = false }) {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId ?? params.id;

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSubtaskId, setSelectedSubtaskId] = useState(null);
  const [completingTarget, setCompletingTarget] = useState(null);
  const [previewProof, setPreviewProof] = useState(null);

  function load() {
    setLoading(true);
    fetchTask(taskId)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [taskId]);

  async function updateTaskStatus(status) {
    // Marking done needs proof first — open the modal instead of PATCHing
    // directly (the backend rejects a direct "completed" here anyway).
    if (status === "completed") {
      setCompletingTarget({ type: "task", id: taskId, title: task.title });
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
      if (subtask) setCompletingTarget({ type: "subtask", id: subtaskId, title: subtask.title });
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
      load();
    } catch (err) {
      setError(err.message);
      load();
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
    load();
  }

  async function addTaskComment(text) {
    const res = await apiFetch(`${apiBase}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message);
    load();
  }

  async function addSubtaskComment(subtaskId, text) {
    const res = await apiFetch(`${apiBase}/subtasks/${subtaskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message);
    load();
  }

  async function addSubtask(form) {
    const res = await apiFetch(`${apiBase}/tasks/${taskId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not add subtask.");
    load();
  }

  async function deleteSubtask(subtaskId) {
    const res = await apiFetch(`${apiBase}/subtasks/${subtaskId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.message || "Could not remove subtask.");
      return;
    }
    setSelectedSubtaskId(null);
    load();
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
    <div className="space-y-6 p-6">
      <Link href={resolvedBackHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        ← {backLabel}
      </Link>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading task…</p>
      ) : !task ? (
        <p className="text-sm text-slate-400">Task not found.</p>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {task.priority && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>}
                  <h1 className="text-xl font-semibold text-slate-900">{task.title}</h1>
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
                    {task.is_leader && <span className="ml-1.5 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">You</span>}
                  </p>
                )}
                <div className="mt-2"><DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} /></div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[task.status]}`}>{task.status.replace("_", " ")}</span>
                {canChangeStatus && task.subtask_total === 0 && canManageSubtasks && <StatusSelect value={task.status} onChange={updateTaskStatus} />}
              </div>
            </div>
            {task.description && <p className="mt-4 text-sm text-slate-600">{task.description}</p>}

            {task.subtask_total > 0 && task.subtask_done < task.subtask_total && (
              <p className="mt-3 text-xs text-slate-400">Status is driven by its subtasks below ({task.subtask_done}/{task.subtask_total} done).</p>
            )}

            {task.subtask_total > 0 && task.subtask_done === task.subtask_total && task.status !== "completed" && (
              canManageSubtasks ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3">
                  <p className="text-sm font-medium text-purple-800">Every subtask is done — mark the whole task complete to send it for the supervisor&apos;s rating.</p>
                  <button
                    type="button"
                    onClick={() => setCompletingTarget({ type: "task", id: taskId, title: task.title })}
                    className="shrink-0 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
                  >
                    Mark task complete
                  </button>
                </div>
              ) : (
                <p className="mt-3 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-700">
                  Every subtask is done — waiting for the task leader to mark the whole task complete.
                </p>
              )
            )}

            {task.subtask_total === 0 && task.is_group && !task.is_leader && canChangeStatus && (
              <p className="mt-3 text-xs text-slate-400">Only the task leader can update this task&apos;s status directly.</p>
            )}

            <ProofGallery proofs={task.proofs} onPreview={setPreviewProof} />

            <div className="mt-5 border-t border-slate-100 pt-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Comments</h2>
              <CommentThread comments={task.comments} onSubmit={addTaskComment} placeholder="Comment on this task…" />
            </div>
          </div>

          {task.evaluation ? (
            <RatingDisplay evaluation={task.evaluation} />
          ) : task.status === "completed" && canRate ? (
            <RatingForm onSubmit={submitRating} />
          ) : task.status === "completed" ? (
            <p className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-700">
              Waiting on the supervisor rating before this moves to History.
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Subtasks</h2>
              {canManageSubtasks && <AddSubtaskForm assignees={task.assignees} onAdd={addSubtask} />}
            </div>
            {task.subtasks.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400">No subtasks yet.</p>
            ) : (
              <SubtaskBoard
                subtasks={task.subtasks}
                onStatusChange={updateSubtaskStatus}
                onRequestComplete={(id) => updateSubtaskStatus(id, "completed")}
                onSelect={(id) => setSelectedSubtaskId((cur) => (cur === id ? null : id))}
                selectedId={selectedSubtaskId}
                interactive={canChangeStatus}
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
          </section>
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
    </div>
  );
}
