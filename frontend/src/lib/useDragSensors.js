"use client";

import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * How cards are picked up on the task boards.
 *
 * - Mouse: a short drag (a few pixels) picks the card up straight away, like any desktop
 *   drag. A plain click still opens the card.
 * - Touch: press and hold for a moment, then drag. A quick swipe still scrolls the page,
 *   because the browser is only told to stop scrolling once the card has been picked up.
 *
 * (A single PointerSensor with a hold delay made the mouse feel dead — drag too soon and the
 * pick-up was cancelled — and on phones the browser took over the touch as a scroll or a
 * text selection before the hold was over.)
 */
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );
}

/** Classes for a draggable row: no text selection or iOS callout while it is held. */
export const DRAG_ROW_CLASS = "select-none [-webkit-touch-callout:none]";

/** A long press on a phone opens the browser's context menu; do not let that steal the drag. */
export function blockTouchContextMenu(event) {
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) event.preventDefault();
}
