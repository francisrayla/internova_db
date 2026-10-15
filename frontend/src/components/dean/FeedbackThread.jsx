"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatDate, formatTime, timeAgo } from "@/lib/timeAgo";
import { Pill } from "@/components/dean/ui";
import { btnClass } from "@/components/dash/page";
import { useCurrentUser } from "@/lib/UserContext";
import { headTitle } from "@/lib/headTitle";

const STATUS = {
  open: { label: "Open", tone: "amber" },
  acknowledged: { label: "Acknowledged", tone: "blue" },
  resolved: { label: "Resolved", tone: "green" },
};

const MAX = 2000;

async function post(url, body) {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || data.errors?.message?.[0] || "That didn't work. Please try again.");
  return data;
}

/**
 * One feedback conversation (Dean message + replies) with the actions each side has:
 * the coordinator can acknowledge and reply, the Dean can reply, resolve and reopen.
 * `base` is the API prefix for this side, e.g. /api/dean/coordinator/feedback.
 */
export default function FeedbackThread({ thread, viewer, base, onUpdate }) {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = STATUS[thread.status] ?? STATUS.open;
  const isDean = viewer === "dean";

  async function run(action, path, body) {
    setBusy(action);
    setError("");
    try {
      const data = await post(`${base}/${thread.id}/${path}`, body);
      if (data.feedback) onUpdate(data.feedback);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Write your reply first.");
      return;
    }
    if (await run("reply", "reply", { message })) {
      setMessage("");
      setOpen(false);
    }
  }

  return (
    <li className={`dash-card ${thread.unread > 0 ? "border-blue-300" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">{isDean ? "You" : thread.dean_name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {thread.unread > 0 && <Pill tone="blue">New</Pill>}
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{thread.message}</p>
      <p className="mt-2 text-xs text-slate-500">
        {timeAgo(thread.created_at)} · {formatDate(thread.created_at)} {formatTime(thread.created_at)}
        {isDean && (thread.seen ? ` · Seen ${timeAgo(thread.read_at)}` : " · Not seen yet")}
      </p>

      {thread.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3 max-sm:pl-2">
          {thread.replies.map((r) => (
            <li key={r.id} className={`rounded-xl px-3 py-2 ${r.mine ? "bg-blue-50" : "bg-slate-50"}`}>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{r.mine ? "You" : r.sender_name}</span>
                <span>{timeAgo(r.created_at)}</span>
                {r.unread && <Pill tone="blue">New</Pill>}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{r.message}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
        {!isDean && thread.status === "open" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("ack", "acknowledge")} className={btnClass("secondary", { sm: true })}>
            {busy === "ack" ? "Saving…" : "Acknowledge"}
          </button>
        )}
        {isDean && thread.status !== "resolved" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("resolve", "resolve")} className={btnClass("secondary", { sm: true })}>
            {busy === "resolve" ? "Saving…" : "Mark resolved"}
          </button>
        )}
        {isDean && thread.status === "resolved" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("reopen", "reopen")} className={btnClass("secondary", { sm: true })}>
            {busy === "reopen" ? "Saving…" : "Reopen"}
          </button>
        )}
        {thread.can_reply && !open && (
          <button type="button" onClick={() => setOpen(true)} className={btnClass("secondary", { sm: true })}>Reply</button>
        )}
        {!thread.can_reply && <span className="text-xs text-slate-500">Marked resolved. Ask your {headTitle(user)} to reopen it if you need to reply.</span>}
      </div>

      {open && thread.can_reply && (
        <form onSubmit={sendReply} className="relative mt-3">
          <label className="sr-only" htmlFor={`reply-${thread.id}`}>Your reply</label>
          <textarea
            id={`reply-${thread.id}`}
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
            rows={3}
            placeholder="Write a reply"
            className="k-input"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{message.length} / {MAX}</span>
            <span className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
              <button type="button" onClick={() => { setOpen(false); setError(""); }} className={btnClass("ghost", { sm: true })}>Cancel</button>
              <button type="submit" disabled={Boolean(busy) || !message.trim()} className={btnClass("primary", { sm: true })}>
                {busy === "reply" ? "Sending…" : "Send reply"}
              </button>
            </span>
          </div>
        </form>
      )}
      {error && <p className="k-note is-risk mt-3" role="alert">{error}</p>}
    </li>
  );
}
