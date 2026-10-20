"use client";

import { useState } from "react";
import { CircleHelp, GripVertical, X } from "lucide-react";

// Shown above the task list (kind="tasks") and the subtask list (kind="subtasks").
// It opens by itself until the intern taps "Got it" (remembered in this browser);
// after that a small "How to move ..." link brings it back.
const STORE_KEY = "internova_drag_guide_";

const COPY = {
  tasks: {
    title: "How to move a task",
    reopen: "How to move tasks",
    item: "task",
    notes: [
      "Only tasks with the grip mark can be moved.",
      "A task with subtasks moves on its own: open it and move its subtasks.",
      "In a group task, only the leader moves the task.",
    ],
  },
  subtasks: {
    title: "How to move a subtask",
    reopen: "How to move subtasks",
    item: "subtask",
    notes: [
      "You can also pick a status from the menu on the right of each subtask.",
      "Once a subtask is Done it stays Done, so check your proof before you confirm.",
      "The task's own status follows its subtasks.",
    ],
  },
};

function readSeen(kind) {
  try {
    return window.localStorage.getItem(STORE_KEY + kind) === "1";
  } catch {
    return false;
  }
}

function isTouch() {
  return typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
}

export default function DragGuide({ kind = "tasks" }) {
  const copy = COPY[kind] ?? COPY.tasks;
  // The boards render only after their data loads in the browser, so reading
  // localStorage while setting the first state is safe here.
  const [open, setOpen] = useState(() => !readSeen(kind));
  const [touch] = useState(isTouch);

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORE_KEY + kind, "1");
    } catch {
      // Private mode or blocked storage: the guide simply shows again next time.
    }
  }

  if (!open) {
    return (
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="dash-link inline-flex items-center gap-1.5 text-sm max-sm:min-h-[44px]"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" /> {copy.reopen}
        </button>
      </div>
    );
  }

  const steps = [
    touch
      ? `Press and hold a ${copy.item} for a moment until it lifts.`
      : `Click and hold a ${copy.item}, then drag it.`,
    "Three boxes appear at the bottom of the screen: Pending, Ongoing and Done.",
    `${touch ? "Slide" : "Drag"} it onto the new status and let go. Moving it to Done asks for your proof of work first.`,
  ];

  return (
    <section
      aria-label={copy.title}
      className="mb-3 rounded-[14px] border p-4"
      style={{ borderColor: "var(--ui-line)", background: "var(--ui-info-bg)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--ui-ink)" }}>
          <GripVertical className="h-4 w-4" aria-hidden="true" style={{ color: "var(--ui-info)" }} />
          {copy.title}
        </h3>
        <button
          type="button"
          onClick={close}
          aria-label="Close the guide"
          className="-m-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full max-sm:h-11 max-sm:w-11"
          style={{ color: "var(--ui-muted)" }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ol className="mt-3 space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3 text-sm" style={{ color: "var(--ui-ink)" }}>
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: "var(--ui-surface)", color: "var(--ui-info)" }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--ui-muted)" }}>
        <li>A quick {touch ? "tap" : "click"} still opens the {copy.item}. Let go outside the boxes to cancel.</li>
        {copy.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="k-btn is-primary is-sm max-sm:min-h-[44px]"
        >
          Got it
        </button>
      </div>
    </section>
  );
}
