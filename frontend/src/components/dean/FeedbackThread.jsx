"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatDate, formatTime, timeAgo } from "@/lib/timeAgo";
import { Pill } from "@/components/dean/ui";

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
    <li className={`rounded-2xl border bg-white p-4 ${thread.unread > 0 ? "border-blue-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{isDean ? "You" : thread.dean_name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {thread.unread > 0 && <Pill tone="blue">New</Pill>}
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{thread.message}</p>
      <p className="mt-2 text-xs text-slate-500">
        {timeAgo(thread.created_at)} · {formatDate(thread.created_at)} {formatTime(thread.created_at)}
        {isDean && (thread.seen ? ` · Seen ${timeAgo(thread.read_at)}` : " · Not seen yet")}
      </p>

      {thread.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isDean && thread.status === "open" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("ack", "acknowledge")} className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
            {busy === "ack" ? "Saving…" : "Acknowledge"}
          </button>
        )}
        {isDean && thread.status !== "resolved" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("resolve", "resolve")} className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
            {busy === "resolve" ? "Saving…" : "Mark resolved"}
          </button>
        )}
        {isDean && thread.status === "resolved" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => run("reopen", "reopen")} className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {busy === "reopen" ? "Saving…" : "Reopen"}
          </button>
        )}
        {thread.can_reply && !open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Reply</button>
        )}
        {!thread.can_reply && <span className="text-xs text-slate-500">Marked resolved. Ask your Dean to reopen it if you need to reply.</span>}
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
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{message.length} / {MAX}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => { setOpen(false); setError(""); }} className="rounded-xl px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={Boolean(busy) || !message.trim()} className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {busy === "reply" ? "Sending…" : "Send reply"}
              </button>
            </span>
          </div>
        </form>
      )}
      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
