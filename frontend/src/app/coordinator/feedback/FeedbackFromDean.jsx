"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import FeedbackThread from "@/components/dean/FeedbackThread";
import { FEEDBACK_READ_EVENT } from "@/components/FeedbackUnreadWatcher";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

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
        <p className="mt-1 text-slate-600">Remarks your Dean has sent you. Tap Acknowledge to let them know you have seen it, or reply to follow up. They mark it resolved once it is dealt with.</p>
      </div>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your feedback.</ErrorNote>}
      {!items && !error && <SkeletonList rows={2} height="h-24" />}

      {items?.length === 0 && (
        <EmptyState icon="message" title="No feedback yet" text="When your Dean sends you a remark, you'll get a notification and it will appear here." />
      )}

      <ul className="space-y-3">
        {items?.map((f) => (
          <FeedbackThread key={f.id} thread={f} viewer="coordinator" base="/api/coordinator/feedback" onUpdate={(u) => setItems((list) => list.map((x) => (x.id === u.id ? u : x)))} />
        ))}
      </ul>
    </div>
  );
}
