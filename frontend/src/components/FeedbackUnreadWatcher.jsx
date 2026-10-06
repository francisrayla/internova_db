"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

export const FEEDBACK_READ_EVENT = "internova:feedback-read";
const COORDINATOR_TYPES = ["dean_feedback"];
const DEAN_TYPES = ["dean_feedback_reply", "dean_feedback_ack"];

/**
 * Renders nothing; keeps the sidebar badge for Dean feedback (coordinator: "Dean Feedback",
 * Dean: "Coordinator") in sync: on every page change, when a feedback notification arrives live, and
 * when the feedback page marks everything read.
 */
export default function FeedbackUnreadWatcher({ onCount, role = "coordinator" }) {
  const endpoint = role === "dean" ? "/api/dean/coordinator/feedback/unread-count" : "/api/coordinator/feedback/unread-count";
  const pathname = usePathname();

  const refresh = useCallback(() => {
    apiFetch(endpoint, { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) onCount(data.unread_count ?? 0);
      })
      .catch(() => {});
  }, [onCount, endpoint]);

  useEffect(refresh, [refresh, pathname]);
  useLiveRefresh(role === "dean" ? DEAN_TYPES : COORDINATOR_TYPES, refresh);

  useEffect(() => {
    const clear = () => onCount(0);
    window.addEventListener(FEEDBACK_READ_EVENT, clear);
    return () => window.removeEventListener(FEEDBACK_READ_EVENT, clear);
  }, [onCount]);

  return null;
}
