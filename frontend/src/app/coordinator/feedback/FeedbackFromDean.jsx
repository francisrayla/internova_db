"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { formatDate, formatTime, timeAgo } from "@/lib/timeAgo";
import { FEEDBACK_READ_EVENT } from "@/components/FeedbackUnreadWatcher";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/dean/ui";

export default function FeedbackFromDean() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchCoordinatorData("feedback")
      .then(async (data) => {
        // Show which ones were new on this visit, then mark everything read.
        setItems(data.items);
        setError(false);
        if (data.unread_count > 0) {
          await apiFetch("/api/coordinator/feedback/read-all", { method: "POST", headers: { Accept: "application/json" } }).catch(() => {});
          window.dispatchEvent(new Event(FEEDBACK_READ_EVENT));
        }
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="space-y-5 sm:p-2 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Feedback from Dean</h1>
        <p className="mt-1 text-slate-600">Remarks your Dean has sent you. This is one-way for now, so you can&apos;t reply here. Talk to your Dean directly if you need to follow up.</p>
      </div>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your feedback.</ErrorNote>}
      {!items && !error && <SkeletonList rows={2} height="h-24" />}

      {items?.length === 0 && (
        <EmptyState icon="message" title="No feedback yet" text="When your Dean sends you a remark, you'll get a notification and it will appear here." />
      )}

      <ul className="space-y-3">
        {items?.map((f) => (
          <li key={f.id} className={`rounded-2xl border bg-white p-4 ${f.read ? "border-slate-200" : "border-blue-300"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{f.dean_name}</p>
              {!f.read && <Pill tone="blue">New</Pill>}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{f.message}</p>
            <p className="mt-3 text-xs text-slate-500">
              {timeAgo(f.created_at)} · {formatDate(f.created_at)} {formatTime(f.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
