/**
 * How close a task/subtask is to its due date, as a 3-level color scale:
 * white/neutral while there's still real runway, yellow once it's getting
 * close, red once it's due very soon or already overdue. Completed items
 * never get an urgency badge — there's nothing left to be urgent about.
 */
export function dueDateUrgency(dueDateRaw, status) {
  if (!dueDateRaw || status === "completed") return null;

  const due = new Date(`${dueDateRaw}T23:59:59`);
  const now = new Date();
  const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { level: "red", label: "Overdue" };
  if (diffDays === 0) return { level: "red", label: "Due today" };
  if (diffDays === 1) return { level: "red", label: "Due tomorrow" };
  if (diffDays <= 3) return { level: "yellow", label: `Due in ${diffDays}d` };
  return { level: "white", label: `Due in ${diffDays}d` };
}

export const URGENCY_DOT_STYLES = {
  red: "bg-red-500",
  yellow: "bg-amber-400",
  white: "bg-slate-300",
};

export const URGENCY_BADGE_STYLES = {
  red: "bg-red-50 text-red-700 border-red-200",
  yellow: "bg-amber-50 text-amber-700 border-amber-200",
  white: "bg-white text-slate-500 border-slate-200",
};
