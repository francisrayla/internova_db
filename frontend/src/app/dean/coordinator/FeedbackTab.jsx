"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { FEEDBACK_READ_EVENT } from "@/components/FeedbackUnreadWatcher";
import FeedbackThread from "@/components/dean/FeedbackThread";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

const MAX = 2000;

export default function FeedbackTab({ coordinator, onSent }) {
  const [items, setItems] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/feedback")
      .then(async (d) => {
        // Keep the "new" markers from this visit, then mark the coordinator's replies as read.
        setItems(d.items);
        setLoadError(false);
        if (d.unread_count > 0) {
          await apiFetch("/api/dean/coordinator/feedback/read-all", { method: "POST", headers: { Accept: "application/json" } }).catch(() => {});
          window.dispatchEvent(new Event(FEEDBACK_READ_EVENT));
          onSent?.();
        }
      })
      .catch(() => setLoadError(true));
  }, [onSent]);

  useEffect(load, [load]);

  const canSend = coordinator?.status === "active";

  async function send(e) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Write your feedback first.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/dean/coordinator/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || data.errors?.message?.[0] || "We couldn't send that. Please try again.");
      setMessage("");
      setNotice("Sent. Your coordinator was notified.");
      load();
      onSent?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={send} className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Send feedback to your coordinator</h3>
        <p className="mt-1 text-sm text-slate-500">
          Share praise, concerns or things to follow up on. They&apos;ll get a notification and can read it under &quot;Dean Feedback&quot;. They can acknowledge it and reply, and you can mark a conversation resolved when it is dealt with.
        </p>
        {!canSend ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {coordinator ? "Your coordinator needs to accept their invitation before they can read feedback." : "You need a coordinator before you can send feedback."}
          </p>
        ) : (
          <>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
              rows={4}
              placeholder="Example: Please review the pending documents this week, thank you."
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">{message.length} / {MAX}</span>
              <button type="submit" disabled={busy || !message.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {busy ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </>
        )}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      </form>

      <section>
        <h3 className="mb-3 text-base font-semibold text-slate-900">Conversations</h3>
        {loadError && <ErrorNote onRetry={load}>We couldn&apos;t load your feedback.</ErrorNote>}
        {!items && !loadError && <SkeletonList rows={2} height="h-20" />}
        {items?.length === 0 && <EmptyState icon="message" title="No feedback sent yet" text="Messages you send will be listed here, with your coordinator's replies and whether it is open, acknowledged or resolved." />}
        <ul className="space-y-3">
          {items?.map((f) => (
            <FeedbackThread key={f.id} thread={f} viewer="dean" base="/api/dean/coordinator/feedback" onUpdate={(u) => setItems((list) => list.map((x) => (x.id === u.id ? u : x)))} />
          ))}
        </ul>
      </section>
    </div>
  );
}
