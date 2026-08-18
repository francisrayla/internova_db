"use client";

import { dueDateUrgency, URGENCY_BADGE_STYLES, URGENCY_DOT_STYLES } from "@/lib/dueDateUrgency";

export default function DueDateBadge({ dueDateRaw, status }) {
  const urgency = dueDateUrgency(dueDateRaw, status);
  if (!urgency) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${URGENCY_BADGE_STYLES[urgency.level]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${URGENCY_DOT_STYLES[urgency.level]}`} />
      {urgency.label}
    </span>
  );
}
