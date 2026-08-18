"use client";

import Link from "next/link";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { useState } from "react";
import DueDateBadge from "@/components/DueDateBadge";

const STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "Ongoing" },
  { key: "completed", label: "Done" },
];

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

const COLUMN_STYLES = {
  pending: "bg-slate-50 border-slate-200",
  in_progress: "bg-blue-50 border-blue-200",
  completed: "bg-emerald-50 border-emerald-200",
};

function CardBody({ task, subLabel }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-900">{task.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
      </div>
      {subLabel && <p className="text-xs text-slate-500">{subLabel}</p>}
      <DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} />
      {task.status === "completed" && !task.evaluation && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
          Awaiting supervisor rating
        </span>
      )}
      {task.subtask_total > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round((task.subtask_done / task.subtask_total) * 100)}%` }} />
          </div>
          <p className="text-[11px] font-medium text-slate-500">{task.subtask_done}/{task.subtask_total} subtasks — open to drag them →</p>
        </div>
      )}
    </>
  );
}

// Non-draggable — either the task already has subtasks (its status is
// derived from them, see SubtaskBoard) or it's a group task and this intern
// isn't the leader (only the leader drives the shared status directly; a
// regular member just works whatever subtask lands on them). Still links
// through to view it either way.
function StaticRow({ task, detailBasePath, subLabel }) {
  return (
    <Link href={`${detailBasePath}/${task.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow">
      <div className="flex-1 space-y-2">
        <CardBody task={task} subLabel={subLabel} />
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
    </Link>
  );
}

// Press and hold to pick this card up (see the PointerSensor delay below) —
// a quick tap still navigates normally, since dnd-kit only starts a drag
// once the hold duration is met.
function HoldableRow({ task, detailBasePath, subLabel, isBeingDragged }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: String(task.id) });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isBeingDragged ? "opacity-30" : ""}>
      <Link href={`${detailBasePath}/${task.id}`} className="flex cursor-grab items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow active:cursor-grabbing">
        <div className="flex-1 space-y-2">
          <CardBody task={task} subLabel={subLabel} />
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
      </Link>
    </div>
  );
}

function OverlayCard({ task }) {
  return (
    <div className="w-80 space-y-2 rounded-2xl border border-blue-300 bg-white p-4 shadow-xl">
      <CardBody task={task} />
    </div>
  );
}

function DropColumn({ status, label }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div ref={setNodeRef} className={`flex h-32 flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed p-4 transition ${COLUMN_STYLES[status]} ${isOver ? "ring-2 ring-blue-400" : ""}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-xs text-slate-400">Drop here</span>
    </div>
  );
}

/**
 * Resting state is a plain list — no Kanban clutter until you're actually
 * moving something. Press and hold a task (no subtasks yet) to pick it up;
 * the three status drop zones only appear while you're holding it, then the
 * list returns once you drop.
 */
export default function TaskListBoard({ tasks, detailBasePath, onStatusChange, onRequestComplete, subLabelFor }) {
  const [activeId, setActiveId] = useState(null);
  // tolerance needs real slack — a genuinely still hand can't hold a mouse
  // perfectly steady for 350ms, and too tight a tolerance silently cancels
  // the long-press the moment natural hand tremor exceeds it.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 350, tolerance: 25 } }));

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const taskId = Number(active.id);
    const newStatus = String(over.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    // Dropping on "Done" needs proof first — the modal decides whether the
    // status actually changes, so we don't touch it here.
    if (newStatus === "completed") {
      onRequestComplete(taskId);
      return;
    }
    onStatusChange(taskId, newStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      {activeId && (
        <div className="fixed inset-x-4 bottom-4 z-40 grid grid-cols-1 gap-3 rounded-3xl bg-white/95 p-3 shadow-2xl backdrop-blur md:grid-cols-3 lg:inset-x-auto lg:right-6 lg:w-[36rem]">
          {STATUSES.map((s) => <DropColumn key={s.key} status={s.key} label={s.label} />)}
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((t) => {
          const canDrag = t.subtask_total === 0 && (!t.is_group || t.is_leader);
          return canDrag ? (
            <HoldableRow key={t.id} task={t} detailBasePath={detailBasePath} subLabel={subLabelFor?.(t)} isBeingDragged={t.id === activeId} />
          ) : (
            <StaticRow key={t.id} task={t} detailBasePath={detailBasePath} subLabel={subLabelFor?.(t)} />
          );
        })}
      </div>

      <DragOverlay>{activeTask ? <OverlayCard task={activeTask} /> : null}</DragOverlay>
    </DndContext>
  );
}
