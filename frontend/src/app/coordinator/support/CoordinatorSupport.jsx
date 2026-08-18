"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";

const CATEGORIES = ["Billing", "Account", "Platform", "General"];

const STATUS_STYLES = {
  Open: "bg-blue-100 text-blue-700",
  Resolved: "bg-slate-100 text-slate-600",
};

function NewTicketForm({ onClose, onCreated }) {
  const [form, setForm] = useState({ subject: "", category: "General", message: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      setError("Enter a subject and a message.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Contact Support</h3>
        <p className="mt-1 text-xs text-slate-500">Reaches the Internova team directly — billing, your account, or anything about the platform.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Subject</span>
            <input
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
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={4}
              placeholder="Describe what's going on…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
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

function TicketThread({ ticketId, onBack, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetchCoordinatorData(`support-tickets/${ticketId}`)
      .then((r) => setTicket(r.ticket))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [ticketId]);

  async function handleReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/coordinator/support-tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not send your reply.");
      setReply("");
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

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

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

            <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
              {ticket.messages.map((m) => (
                <div key={m.id} className={`flex ${m.is_superadmin ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.is_superadmin ? "border border-slate-200 bg-slate-50 text-slate-800" : "bg-blue-600 text-white"}`}>
                    <p className={`mb-1 text-[11px] font-semibold ${m.is_superadmin ? "text-slate-500" : "text-blue-100"}`}>
                      {m.is_superadmin ? "Internova Support" : "You"} · {m.created_at}
                    </p>
                    <p>{m.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {ticket.status !== "Resolved" && (
            <form onSubmit={handleReply} className="flex gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button type="submit" disabled={sending || !reply.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {sending ? "…" : "Reply"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export default function CoordinatorSupport() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);

  function load() {
    setLoading(true);
    fetchCoordinatorData("support-tickets")
      .then((r) => setTickets(r.tickets ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (openTicketId) {
    return <TicketThread ticketId={openTicketId} onBack={() => { setOpenTicketId(null); load(); }} onUpdated={load} />;
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
        <NewTicketForm onClose={() => setShowNewForm(false)} onCreated={() => { setShowNewForm(false); load(); }} />
      )}
    </div>
  );
}
