"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLES = {
  Open: "bg-blue-100 text-blue-700",
  Resolved: "bg-slate-100 text-slate-600",
};

function TicketThread({ ticketId, onBack, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetchSuperadminData(`support-messages/${ticketId}`)
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
      const res = await apiFetch(`/api/superadmin/support-messages/${ticketId}/reply`, {
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

  async function toggleStatus() {
    const nextStatus = ticket.status === "Open" ? "Resolved" : "Open";
    try {
      const res = await apiFetch(`/api/superadmin/support-messages/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update status.");
      load();
      onUpdated();
    } catch (err) {
      setError(err.message);
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
                <p className="mt-1 text-xs text-slate-500">
                  {ticket.school_name} · {ticket.coordinator_name} · {ticket.category} · Opened {ticket.created_at}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[ticket.status]}`}>{ticket.status}</span>
                <button onClick={toggleStatus} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Mark as {ticket.status === "Open" ? "Resolved" : "Open"}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
              {ticket.messages.map((m) => (
                <div key={m.id} className={`flex ${m.is_superadmin ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.is_superadmin ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-800"}`}>
                    <p className={`mb-1 text-[11px] font-semibold ${m.is_superadmin ? "text-blue-100" : "text-slate-500"}`}>
                      {m.is_superadmin ? "You (Support)" : m.sender_name} · {m.created_at}
                    </p>
                    <p>{m.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}

export default function SupportPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTicketId, setOpenTicketId] = useState(null);

  function load() {
    setLoading(true);
    fetchSuperadminData("support-messages")
      .then((r) => setMessages(r.messages ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (openTicketId) {
    return <TicketThread ticketId={openTicketId} onBack={() => { setOpenTicketId(null); load(); }} onUpdated={load} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Support</h2>
        <p className="mt-1 text-sm text-slate-600">
          Requests school coordinators send in for help with billing, accounts, or the platform.
        </p>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No support requests yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {["School", "Subject", "Category", "Status", "Last Message"].map((h) => (
                  <th key={h} className="px-6 py-3 text-left font-semibold text-slate-700">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {messages.map((msg) => (
                <tr key={msg.id} onClick={() => setOpenTicketId(msg.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-6 py-4 font-medium text-slate-900">{msg.school_name}</td>
                  <td className="px-6 py-4 text-slate-600">{msg.subject}</td>
                  <td className="px-6 py-4 text-slate-600">{msg.category}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[msg.status]}`}>
                      {msg.status}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-6 py-4 text-slate-600">{msg.last_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
