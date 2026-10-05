"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { validateAttachmentFile } from "@/lib/imageValidation";
import TicketAttachment from "@/components/TicketAttachment";
import AttachButton, { AttachIconButton, FileChip } from "@/components/TicketAttachButton";

import { inputProps } from "@/lib/inputRules";
const CATEGORIES = ["Billing", "Account", "Platform", "General"];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const STATUS_STYLES = {
  Open: "bg-blue-100 text-blue-700",
  Resolved: "bg-slate-100 text-slate-600",
};

function NewTicketForm({ role, onClose, onCreated }) {
  const [form, setForm] = useState({ subject: "", category: "General", message: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pickFile(picked) {
    const err = validateAttachmentFile(picked, MAX_ATTACHMENT_BYTES);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setFile(picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      setError("Enter a subject and a message.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      body.append("subject", form.subject);
      body.append("category", form.category);
      body.append("message", form.message);
      if (file) body.append("attachment", file);
      const res = await apiFetch(`/api/${role}/support-tickets`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not send your request.");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Contact Support</h3>
        <p className="mt-1 text-xs text-slate-500">Reaches the Internova team directly — billing, your account, or anything about the platform.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Subject</span>
            <input {...inputProps("subject")}
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Payment not reflecting"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Message</span>
            <textarea {...inputProps("message")}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={4}
              placeholder="Describe what's going on…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Attachment (optional)</span>
            <AttachButton file={file} onPick={pickFile} onRemove={() => setFile(null)} disabled={saving} />
            <span className="mt-1 block text-xs text-slate-400">Screenshot, receipt, or document — up to 5MB.</span>
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Sending…" : "Send to Support"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TicketThread({ role, ticketId, onBack, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  function load() {
    setLoading(true);
    fetchApiData(role, `support-tickets/${ticketId}`)
      .then((r) => setTicket(r.ticket))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [ticketId, role]);

  // Same auto-scroll-to-latest as the Messenger widget's own message list.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [ticket?.messages]);

  function pickFile(picked) {
    const err = validateAttachmentFile(picked, MAX_ATTACHMENT_BYTES);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setFile(picked);
  }

  async function handleReply(e) {
    e.preventDefault();
    if (!reply.trim() && !file) return;
    setSending(true);
    setError("");
    try {
      const body = new FormData();
      if (reply.trim()) body.append("message", reply.trim());
      if (file) body.append("attachment", file);
      const res = await apiFetch(`/api/${role}/support-tickets/${ticketId}/reply`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not send your reply.");
      setReply("");
      setFile(null);
      load();
      onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        ← Back to Support
      </button>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !ticket ? (
        <p className="text-sm text-slate-400">Ticket not found.</p>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">{ticket.subject}</h1>
                <p className="mt-1 text-xs text-slate-500">{ticket.category} · Opened {ticket.created_at}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[ticket.status]}`}>{ticket.status}</span>
            </div>

            <div ref={listRef} className="mt-5 max-h-[50vh] overflow-y-auto border-t border-slate-100 pt-5">
              {ticket.messages.map((m, i) => {
                // Same grouping the Messenger widget uses: the sender label
                // and timestamp only show once at the start of a run of
                // consecutive messages from the same person, not repeated on
                // every single bubble — that's what made this screen look
                // noisy compared to an ordinary chat.
                const startsRun = i === 0 || ticket.messages[i - 1].is_superadmin !== m.is_superadmin;
                return (
                  <div key={m.id} className={`flex ${m.is_superadmin ? "justify-start" : "justify-end"} ${startsRun ? "mt-3 first:mt-0" : "mt-1"}`}>
                    <div className="max-w-[80%]">
                      {startsRun && (
                        <p className={`mb-1 text-[11px] font-semibold text-slate-400 ${m.is_superadmin ? "text-left" : "text-right"}`}>
                          {m.is_superadmin ? "Internova Support" : "You"} · {m.created_at}
                        </p>
                      )}
                      <div className={`min-w-16 space-y-2 rounded-2xl px-4 py-2.5 text-sm ${m.is_superadmin ? "border border-slate-200 bg-slate-50 text-slate-800" : "bg-blue-600 text-white"}`}>
                        <TicketAttachment url={m.attachment_url} name={m.attachment_name} type={m.attachment_type} size={m.attachment_size} mine={!m.is_superadmin} />
                        {m.message && <p>{m.message}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

            {/* Resolved isn't a dead end — replying here reopens the ticket
                (see CoordinatorSupportController::reply), so there's never a
                case where a coordinator has a follow-up but no way to send
                it. Kept inside the same card as the thread, not a separate
                box below, so the whole conversation reads as one panel. */}
            <form onSubmit={handleReply} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <FileChip file={file} onRemove={() => setFile(null)} />
              <div className="flex items-center gap-2">
                <AttachIconButton onPick={pickFile} disabled={sending} />
                <input {...inputProps("message")}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <button type="submit" disabled={sending || (!reply.trim() && !file)} className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {sending ? "…" : "Reply"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/** Shared by the coordinator and the dean — role picks the /api/<role>/support-tickets area. */
export default function CoordinatorSupport({ role = "coordinator" }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);

  function load() {
    setLoading(true);
    fetchApiData(role, "support-tickets")
      .then((r) => setTickets(r.tickets ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [role]);

  if (openTicketId) {
    return <TicketThread role={role} ticketId={openTicketId} onBack={() => { setOpenTicketId(null); load(); }} onUpdated={load} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Support</h2>
          <p className="mt-1 text-sm text-slate-600">Reach the Internova team directly — billing, your account, or the platform.</p>
        </div>
        <button onClick={() => setShowNewForm(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          + Contact Support
        </button>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No support requests yet — reach out if you run into anything.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => setOpenTicketId(t.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-slate-900">{t.subject}</p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t.category}</span>
                  </div>
                  {t.last_message && <p className="mt-1 truncate text-xs text-slate-500">{t.last_message}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[t.status]}`}>{t.status}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {showNewForm && (
        <NewTicketForm role={role} onClose={() => setShowNewForm(false)} onCreated={() => { setShowNewForm(false); load(); }} />
      )}
    </div>
  );
}
