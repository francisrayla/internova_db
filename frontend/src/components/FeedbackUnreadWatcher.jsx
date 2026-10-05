"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

export const FEEDBACK_READ_EVENT = "internova:feedback-read";
const LIVE_TYPES = ["dean_feedback"];

/**
 * Renders nothing; keeps the coordinator sidebar's "Dean Feedback" badge in
 * sync: on every page change, when a feedback notification arrives live, and
 * when the feedback page marks everything read.
 */
export default function FeedbackUnreadWatcher({ onCount }) {
  const pathname = usePathname();

  const refresh = useCallback(() => {
    apiFetch("/api/coordinator/feedback/unread-count", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) onCount(data.unread_count ?? 0);
      })
      .catch(() => {});
  }, [onCount]);

  useEffect(refresh, [refresh, pathname]);
  useLiveRefresh(LIVE_TYPES, refresh);

  useEffect(() => {
    const clear = () => onCount(0);
    window.addEventListener(FEEDBACK_READ_EVENT, clear);
    return () => window.removeEventListener(FEEDBACK_READ_EVENT, clear);
  }, [onCount]);

  return null;
}
