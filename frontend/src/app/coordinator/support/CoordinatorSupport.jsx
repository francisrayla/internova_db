"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { validateAttachmentFile } from "@/lib/imageValidation";
import TicketAttachment from "@/components/TicketAttachment";
import AttachButton, { AttachIconButton, FileChip } from "@/components/TicketAttachButton";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, DataList, DataRow, FormField, Input, Page, PageHeader, Section, Select, SheetFrame, Textarea } from "@/components/dash/page";
import NavIcon from "@/components/NavIcon";

import { inputProps } from "@/lib/inputRules";
const CATEGORIES = ["Billing", "Account", "Platform", "General"];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const STATUS_TONES = { Open: "blue", Resolved: "slate" };

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
    <SheetFrame
      onClose={onClose}
      title="Contact Support"
      description="Reaches the Internova team directly — billing, your account, or anything about the platform."
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Sending…" : "Send to Support"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Subject">
          <Input {...inputProps("subject")}
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            placeholder="e.g. Payment not reflecting"
            autoFocus
          />
        </FormField>
        <FormField label="Category">
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </FormField>
        <FormField label="Message">
          <Textarea {...inputProps("message")}
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={4}
            placeholder="Describe what's going on…"
          />
        </FormField>
        <FormField label="Attachment (optional)" hint="Screenshot, receipt, or document — up to 5MB.">
          <AttachButton file={file} onPick={pickFile} onRemove={() => setFile(null)} disabled={saving} />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
    <Page size="narrow">
      <div>
        <button type="button" onClick={onBack} className="k-back">
          <NavIcon name="back" size={16} />
          Back to Support
        </button>
      </div>

      {loading ? (
        <SkeletonList rows={2} height="h-20" />
      ) : !ticket ? (
        <p className="text-sm text-slate-600">Ticket not found.</p>
      ) : (
        <Section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-lg font-semibold text-slate-900">{ticket.subject}</h1>
              <p className="mt-1 text-xs text-slate-600">{ticket.category} · Opened {ticket.created_at}</p>
            </div>
            <Pill tone={STATUS_TONES[ticket.status] ?? "slate"}>{ticket.status}</Pill>
          </div>

          <div ref={listRef} className="mt-5 max-h-[50vh] overflow-y-auto border-t border-slate-200 pt-5">
            {ticket.messages.map((m, i) => {
              // Same grouping the Messenger widget uses: the sender label
              // and timestamp only show once at the start of a run of
              // consecutive messages from the same person, not repeated on
              // every single bubble — that's what made this screen look
              // noisy compared to an ordinary chat.
              const startsRun = i === 0 || ticket.messages[i - 1].is_superadmin !== m.is_superadmin;
              return (
                <div key={m.id} className={`flex ${m.is_superadmin ? "justify-start" : "justify-end"} ${startsRun ? "mt-3 first:mt-0" : "mt-1"}`}>
                  <div className="max-w-[85%]">
                    {startsRun && (
                      <p className={`mb-1 text-xs font-semibold text-slate-600 ${m.is_superadmin ? "text-left" : "text-right"}`}>
                        {m.is_superadmin ? "Internova Support" : "You"} · {m.created_at}
                      </p>
                    )}
                    <div className={`min-w-16 space-y-2 break-words rounded-2xl px-4 py-2.5 text-sm ${m.is_superadmin ? "border border-slate-200 bg-slate-50 text-slate-800" : "bg-blue-600 text-white"}`}>
                      <TicketAttachment url={m.attachment_url} name={m.attachment_name} type={m.attachment_type} size={m.attachment_size} mine={!m.is_superadmin} />
                      {m.message && <p>{m.message}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="k-note is-risk mt-3" role="alert">{error}</p>}

          {/* Resolved isn't a dead end — replying here reopens the ticket
              (see CoordinatorSupportController::reply), so there's never a
              case where a coordinator has a follow-up but no way to send
              it. Kept inside the same card as the thread, not a separate
              box below, so the whole conversation reads as one panel. */}
          <form onSubmit={handleReply} className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <FileChip file={file} onRemove={() => setFile(null)} />
            <div className="flex items-center gap-2">
              <AttachIconButton onPick={pickFile} disabled={sending} />
              <Input {...inputProps("message")}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…"
                aria-label="Write a reply"
                className="min-w-0 flex-1"
              />
              <Btn variant="primary" type="submit" className="shrink-0" disabled={sending || (!reply.trim() && !file)}>
                {sending ? "…" : "Reply"}
              </Btn>
            </div>
          </form>
        </Section>
      )}
    </Page>
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
    <Page>
      <PageHeader title="Support" sentence="Reach the Internova team directly — billing, your account, or the platform.">
        <Btn variant="primary" onClick={() => setShowNewForm(true)}>
          <NavIcon name="message" size={15} /> Contact Support
        </Btn>
      </PageHeader>

      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-14" /></div>
        ) : tickets.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="support" title="No support requests yet" text="Reach out if you run into anything." action={<Btn variant="primary" onClick={() => setShowNewForm(true)}>Contact Support</Btn>} />
          </div>
        ) : (
          <DataList>
            {tickets.map((t) => (
              <DataRow
                key={t.id}
                wrap
                onClick={() => setOpenTicketId(t.id)}
                title={<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-words">{t.subject}</span><Pill size="sm">{t.category}</Pill></span>}
                sub={t.last_message ? <span className="block truncate">{t.last_message}</span> : undefined}
                side={<Pill tone={STATUS_TONES[t.status] ?? "slate"} size="sm">{t.status}</Pill>}
              />
            ))}
          </DataList>
        )}
      </Section>

      {showNewForm && (
        <NewTicketForm role={role} onClose={() => setShowNewForm(false)} onCreated={() => { setShowNewForm(false); load(); }} />
      )}
    </Page>
  );
}
