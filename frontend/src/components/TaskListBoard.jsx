"use client";

import Link from "next/link";
import { DndContext, DragOverlay, pointerWithin, useDraggable, useDroppable } from "@dnd-kit/core";
import { DRAG_ROW_CLASS, blockTouchContextMenu, useDragSensors } from "@/lib/useDragSensors";
import { useState } from "react";
import DueDateBadge from "@/components/DueDateBadge";
import { isAwaitingRating } from "@/lib/taskState";
import { Pill } from "@/components/ui";

const STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "Ongoing" },
  { key: "completed", label: "Done" },
];

const STATUS_TONES = { pending: "slate", in_progress: "blue", completed: "green" };
const STATUS_LABELS = { pending: "Pending", in_progress: "Ongoing", completed: "Done" };
const PRIORITY_TONES = { low: "slate", medium: "amber", high: "red" };

const COLUMN_STYLES = {
  pending: "bg-slate-50 border-slate-300",
  in_progress: "bg-blue-50 border-blue-200",
  completed: "bg-emerald-50 border-emerald-200",
};

// One row of the list: title + priority, who/where, due badge, progress; the status chip sits on the right.
const ROW_CLASS = "flex items-start justify-between gap-3 px-4 py-3.5 transition hover:bg-slate-50 sm:px-5 sm:py-4";

function CardBody({ task, subLabel }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 break-words text-[0.9375rem] font-medium text-slate-900">{task.title}</p>
        <Pill tone={PRIORITY_TONES[task.priority] ?? "slate"} size="sm" className="capitalize">{task.priority}</Pill>
      </div>
      {subLabel && <p className="text-sm text-slate-500">{subLabel}</p>}
      <DueDateBadge dueDateRaw={task.due_date_raw} status={task.status} />
      {isAwaitingRating(task) && (
        <span className="inline-flex w-fit"><Pill tone="blue" size="sm">Awaiting supervisor rating</Pill></span>
      )}
      {task.subtask_total > 0 && (
        <div className="space-y-1">
          <div className="k-bar"><span style={{ width: `${Math.round((task.subtask_done / task.subtask_total) * 100)}%` }} /></div>
          <p className="text-xs font-medium text-slate-500">{task.subtask_done}/{task.subtask_total} subtasks, open the task to drag them</p>
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
    <Link href={`${detailBasePath}/${task.id}`} className={ROW_CLASS}>
      <div className="min-w-0 flex-1 space-y-2">
        <CardBody task={task} subLabel={subLabel} />
      </div>
      <Pill tone={STATUS_TONES[task.status]} className="shrink-0">{STATUS_LABELS[task.status]}</Pill>
    </Link>
  );
}

// Drag it with the mouse, or press and hold on a touch screen (see useDragSensors) —
// a plain click or tap still opens the task.
function HoldableRow({ task, detailBasePath, subLabel, isBeingDragged }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: String(task.id) });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onContextMenu={blockTouchContextMenu} className={`${DRAG_ROW_CLASS} ${isBeingDragged ? "opacity-30" : ""}`}>
      {/* draggable={false}: a link is natively draggable, and the browser's own drag would cancel ours */}
      <Link draggable={false} href={`${detailBasePath}/${task.id}`} className={`${ROW_CLASS} cursor-grab active:cursor-grabbing`}>
        <div className="min-w-0 flex-1 space-y-2">
          <CardBody task={task} subLabel={subLabel} />
        </div>
        <Pill tone={STATUS_TONES[task.status]} className="shrink-0">{STATUS_LABELS[task.status]}</Pill>
      </Link>
    </div>
  );
}

function OverlayCard({ task }) {
  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-2xl border border-blue-300 bg-white p-4 shadow-xl">
      <CardBody task={task} />
    </div>
  );
}

function DropColumn({ status, label }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div ref={setNodeRef} className={`flex h-20 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed p-3 md:h-32 md:gap-1 md:p-4 transition ${COLUMN_STYLES[status]} ${isOver ? "ring-2 ring-blue-400" : ""}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-xs text-slate-500">Drop here</span>
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
  const sensors = useDragSensors();

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
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-2xl backdrop-blur md:gap-3 md:p-3 lg:inset-x-auto lg:right-6 lg:w-[36rem]">
          {STATUSES.map((s) => <DropColumn key={s.key} status={s.key} label={s.label} />)}
        </div>
      )}

      <div className="dash-card is-flush divide-y divide-slate-100">
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
