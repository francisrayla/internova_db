"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { FEEDBACK_READ_EVENT } from "@/components/FeedbackUnreadWatcher";
import FeedbackThread from "@/components/dean/FeedbackThread";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";
import { useCurrentUser } from "@/lib/UserContext";
import { headTitle } from "@/lib/headTitle";
import { Btn, FormField, GroupTitle, Textarea } from "@/components/dash/page";

const MAX = 2000;

export default function FeedbackTab({ coordinator, onSent }) {
  const { user } = useCurrentUser();
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
      <form onSubmit={send} className="dash-card">
        <div className="dash-card-head">
          <div className="min-w-0">
            <h2>Send feedback to your coordinator</h2>
            <p>
              Share praise, concerns or things to follow up on. They&apos;ll get a notification and can read it under &quot;{headTitle(user)} Feedback&quot;. They can acknowledge it and reply, and you can mark a conversation resolved when it is dealt with.
            </p>
          </div>
        </div>
        {!canSend ? (
          <p className="k-note is-warn">
            {coordinator ? "Your coordinator needs to accept their invitation before they can read feedback." : "You need a coordinator before you can send feedback."}
          </p>
        ) : (
          <div className="space-y-3">
            <FormField label="Your message" className="[&>.k-label]:sr-only">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
                rows={4}
                placeholder="Example: Please review the pending documents this week, thank you."
              />
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
              <span className="text-xs text-slate-500 max-sm:text-right">{message.length} / {MAX}</span>
              <Btn type="submit" variant="primary" disabled={busy || !message.trim()}>
                {busy ? "Sending…" : "Send feedback"}
              </Btn>
            </div>
          </div>
        )}
        {error && <p className="k-note is-risk mt-3" role="alert">{error}</p>}
        {notice && <p className="k-note is-ok mt-3" role="status">{notice}</p>}
      </form>

      <section>
        <GroupTitle title="Conversations" />
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
