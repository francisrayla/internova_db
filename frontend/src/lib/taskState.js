/**
 * Where a task lives. A finished task waits in the Active list until the supervisor has graded it
 * (the backend sets awaiting_rating: done + no rating + the school's plan includes ratings). Only a
 * finished task that no longer waits for a grade goes to History. If an older response has no
 * awaiting_rating, fall back to "done and not rated yet".
 */
export function isAwaitingRating(task) {
  return task.status === "completed" && (task.awaiting_rating ?? !task.evaluation);
}

export function isTaskClosed(task) {
  return task.status === "completed" && !isAwaitingRating(task);
}
