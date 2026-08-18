"use client";

import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
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

const COLUMN_STYLES = {
  pending: "bg-slate-50 border-slate-200",
  in_progress: "bg-blue-50 border-blue-200",
  completed: "bg-emerald-50 border-emerald-200",
};

function CardBody({ subtask }) {
  return (
    <>
      <p className="font-medium text-slate-900">{subtask.title}</p>
      <p className="mt-1 text-xs text-slate-500">{subtask.assignees?.length > 0 ? subtask.assignees.map((a) => a.name).join(", ") : "Unassigned"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <DueDateBadge dueDateRaw={subtask.due_date_raw} status={subtask.status} />
        <span className="text-[11px] text-slate-400">{subtask.comments.length} comment{subtask.comments.length === 1 ? "" : "s"}</span>
        {subtask.proofs?.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            📎 {subtask.proofs.length} proof{subtask.proofs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </>
  );
}

function Row({ subtask, onSelect, selected }) {
  return (
    <button
      onClick={() => onSelect(subtask.id)}
      className={`flex w-full items-start justify-between gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow ${selected ? "border-blue-400 ring-1 ring-blue-300" : "border-slate-200"}`}
    >
      <div className="flex-1 space-y-1">
        <CardBody subtask={subtask} />
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[subtask.status]}`}>{STATUS_LABELS[subtask.status]}</span>
    </button>
  );
}

// Press and hold to pick this card up; a quick tap still selects it (opens
// the comment panel) since dnd-kit only starts a drag past the hold delay.
function HoldableRow({ subtask, onSelect, selected, isBeingDragged }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: String(subtask.id) });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isBeingDragged ? "opacity-30" : ""}>
      <button
        onClick={() => onSelect(subtask.id)}
        className={`flex w-full cursor-grab items-start justify-between gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow active:cursor-grabbing ${selected ? "border-blue-400 ring-1 ring-blue-300" : "border-slate-200"}`}
      >
        <div className="flex-1 space-y-1">
          <CardBody subtask={subtask} />
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[subtask.status]}`}>{STATUS_LABELS[subtask.status]}</span>
      </button>
    </div>
  );
}

function OverlayCard({ subtask }) {
  return (
    <div className="w-72 space-y-1 rounded-2xl border border-blue-300 bg-white p-3 shadow-xl">
      <CardBody subtask={subtask} />
    </div>
  );
}

function DropColumn({ status, label }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div ref={setNodeRef} className={`flex h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-3 transition ${COLUMN_STYLES[status]} ${isOver ? "ring-2 ring-blue-400" : ""}`}>
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <span className="text-[11px] text-slate-400">Drop here</span>
    </div>
  );
}

/**
 * Resting state is a plain list of subtasks — the Pending/Ongoing/Done drop
 * zones only appear while an intern is actively holding a card, matching
 * the same press-and-hold pattern as the task list one level up (see
 * TaskListBoard). Coordinator/supervisor get the plain list with no drag at
 * all (interactive=false) — clicking still opens the comment panel.
 */
export default function SubtaskBoard({ subtasks, onStatusChange, onRequestComplete, onSelect, selectedId, interactive }) {
  const [activeId, setActiveId] = useState(null);
  // tolerance needs real slack — a genuinely still hand can't hold a mouse
  // perfectly steady for 350ms, and too tight a tolerance silently cancels
  // the long-press the moment natural hand tremor exceeds it.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 350, tolerance: 25 } }));

  const activeSubtask = subtasks.find((s) => s.id === activeId) ?? null;

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const subtaskId = Number(active.id);
    const newStatus = String(over.id);
    const subtask = subtasks.find((s) => s.id === subtaskId);
    if (!subtask || subtask.status === newStatus) return;
    // Dropping on "Done" needs proof first — the modal decides whether the
    // status actually changes, so we don't touch it here.
    if (newStatus === "completed") {
      onRequestComplete(subtaskId);
      return;
    }
    onStatusChange(subtaskId, newStatus);
  }

  if (!interactive) {
    return (
      <div className="space-y-2">
        {subtasks.map((s) => <Row key={s.id} subtask={s} onSelect={onSelect} selected={s.id === selectedId} />)}
      </div>
    );
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
        <div className="fixed inset-x-4 bottom-4 z-40 grid grid-cols-1 gap-2 rounded-3xl bg-white/95 p-3 shadow-2xl backdrop-blur md:grid-cols-3 lg:inset-x-auto lg:right-6 lg:w-[32rem]">
          {STATUSES.map((s) => <DropColumn key={s.key} status={s.key} label={s.label} />)}
        </div>
      )}

      <div className="space-y-2">
        {subtasks.map((s) => (
          <HoldableRow key={s.id} subtask={s} onSelect={onSelect} selected={s.id === selectedId} isBeingDragged={s.id === activeId} />
        ))}
      </div>

      <DragOverlay>{activeSubtask ? <OverlayCard subtask={activeSubtask} /> : null}</DragOverlay>
    </DndContext>
  );
}
