// Small display helpers that several screens used to define for themselves.

/** "Maria Santos" -> "MS". Pass a fallback (such as the email) for users with no name yet. */
export function initialsOf(name, fallback) {
  return (name || fallback || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** 1536 -> "1.5 KB". Returns "" when the size is unknown. */
export function formatBytes(bytes) {
  if (bytes == null || bytes === "") return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 1500 -> "₱1,500" */
export const peso = (n) => `₱${Number(n ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/** (3, "day") -> "3 days" */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
