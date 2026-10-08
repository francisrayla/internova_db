import { DISPLAY_TIME_ZONE, trustedNow } from "@/lib/trustedClock";

/** Today's calendar date in the Philippines as "YYYY-MM-DD", whatever time zone the phone is set to. */
export function manilaToday(now = trustedNow().date) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Whole CALENDAR days from today (Philippine date) to the due date: 0 = due today, 1 = tomorrow,
 * -1 = yesterday. Both sides are plain dates, so the time of day (11:30 PM or 12:05 AM) can never
 * push the answer by a day, which counting elapsed hours and rounding up used to do.
 */
export function calendarDaysUntil(dueDateRaw, now = trustedNow().date) {
  const due = String(dueDateRaw).slice(0, 10).split("-").map(Number);
  const today = manilaToday(now).split("-").map(Number);
  return Math.round((Date.UTC(due[0], due[1] - 1, due[2]) - Date.UTC(today[0], today[1] - 1, today[2])) / 86400000);
}

/**
 * How close a task/subtask is to its due date, as a 3-level color scale:
 * white/neutral while there's still real runway, yellow once it's getting
 * close, red once it's due very soon or already overdue. Completed items
 * never get an urgency badge — there's nothing left to be urgent about.
 */
export function dueDateUrgency(dueDateRaw, status, now) {
  if (!dueDateRaw || status === "completed") return null;

  const diffDays = calendarDaysUntil(dueDateRaw, now);

  if (diffDays < 0) return { level: "red", label: diffDays === -1 ? "Overdue by 1 day" : `Overdue by ${-diffDays} days` };
  if (diffDays === 0) return { level: "red", label: "Due today" };
  if (diffDays === 1) return { level: "red", label: "Due tomorrow" };
  if (diffDays <= 3) return { level: "yellow", label: `Due in ${diffDays} days` };
  return { level: "white", label: `Due in ${diffDays} days` };
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
