// Friendly time helpers for the Dean screens (relative times, day headings, greeting).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return null;
  const diff = now - new Date(iso).getTime();
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), "minute")} ago`;
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), "hour")} ago`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

export function formatDate(iso, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "";
  // Date-only strings (YYYY-MM-DD) are shown as that calendar day, not shifted by the time zone.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso;
  return new Date(value).toLocaleDateString("en-US", options);
}

export function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "Today", "Yesterday", or "Monday, Oct 5" for grouping timelines.
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / DAY);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
