"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";
import { validateAttachmentFile } from "@/lib/imageValidation";
import TicketAttachment from "@/components/TicketAttachment";
import { AttachIconButton, FileChip } from "@/components/TicketAttachButton";
import NavIcon from "@/components/NavIcon";
import Pagination from "@/components/Pagination";
import { Btn, EmptyState, Input, Page, PageHeader, Pill, Section, SkeletonList, TableWrap } from "@/components/dash/page";

import { inputProps } from "@/lib/inputRules";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const PER_PAGE = 15;

const STATUS_TONE = {
  Open: "blue",
  Resolved: "green",
};

function TicketThread({ ticketId, onBack, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  function load() {
    setLoading(true);
    fetchSuperadminData(`support-messages/${ticketId}`)
      .then((r) => setTicket(r.ticket))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [ticketId]);

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
      const res = await apiFetch(`/api/superadmin/support-messages/${ticketId}/reply`, { method: "POST", body });
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
    <Page size="narrow">
      <div>
        <button type="button" onClick={onBack} className="k-back">
          <NavIcon name="back" size={16} />
          Back to Support
        </button>
      </div>

      {loading ? (
        <Section><SkeletonList rows={3} height="h-14" /></Section>
      ) : !ticket ? (
        <Section>
          <EmptyState icon="support" title="Ticket not found." text="It may have been removed. Go back to the list and pick another one." />
        </Section>
      ) : (
        <>
          <PageHeader
            title={ticket.subject}
            meta={`${ticket.school_name} · ${ticket.coordinator_name} · ${ticket.category} · Opened ${ticket.created_at}`}
          >
            <Pill tone={STATUS_TONE[ticket.status] ?? "slate"}>{ticket.status}</Pill>
            <Btn sm onClick={toggleStatus}>
              Mark as {ticket.status === "Open" ? "Resolved" : "Open"}
            </Btn>
          </PageHeader>

          <Section title="Conversation">
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
              {ticket.messages.map((m, i) => {
                const startsRun = i === 0 || ticket.messages[i - 1].is_superadmin !== m.is_superadmin;
                return (
                  <div key={m.id} className={`flex ${m.is_superadmin ? "justify-end" : "justify-start"} ${startsRun ? "mt-3 first:mt-0" : "mt-1"}`}>
                    <div className="max-w-[88%] sm:max-w-[80%]">
                      {startsRun && (
                        <p className={`mb-1 text-xs font-semibold ${m.is_superadmin ? "text-right" : "text-left"}`} style={{ color: "var(--ui-muted)" }}>
                          {m.is_superadmin ? "You (Support)" : m.sender_name} · {m.created_at}
                        </p>
                      )}
                      <div className={`min-w-16 space-y-2 break-words rounded-2xl px-4 py-2.5 text-sm ${m.is_superadmin ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-800"}`}>
                        <TicketAttachment url={m.attachment_url} name={m.attachment_name} type={m.attachment_type} size={m.attachment_size} mine={m.is_superadmin} />
                        {m.message && <p>{m.message}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && <p className="k-note is-risk mt-3" role="alert">{error}</p>}

            <form onSubmit={handleReply} className="mt-4 grid gap-2 pt-4" style={{ borderTop: "1px solid var(--ui-line)" }}>
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
        </>
      )}
    </Page>
  );
}

export default function SupportPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [openTicketId, setOpenTicketId] = useState(null);

  // The server returns one page of tickets at a time (newest activity first).
  function load(nextPage = page) {
    fetchSuperadminData(`support-messages?page=${nextPage}&per_page=${PER_PAGE}`)
      .then((r) => {
        // A page that no longer exists (tickets were removed) falls back to the last one.
        if (nextPage > 1 && (r.messages ?? []).length === 0 && (r.last_page ?? 1) < nextPage) {
          setPage(r.last_page ?? 1);
          return;
        }
        setMessages(r.messages ?? []);
        setMeta({ total: r.total ?? 0, last_page: r.last_page ?? 1 });
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false);
        setPaging(false);
      });
  }

  useEffect(() => {
    load(page);
  }, [page]);

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

  if (openTicketId) {
    return <TicketThread ticketId={openTicketId} onBack={() => { setOpenTicketId(null); load(); }} onUpdated={load} />;
  }

  return (
    <Page size="wide">
      <PageHeader
        title="Support"
        sentence="Requests school deans and coordinators send in for help with billing, accounts, or the platform."
      />

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : messages.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="support" title="No support requests yet." text="When a dean or coordinator asks for help, it shows up here." />
          </div>
        ) : (
          <TableWrap>
            <table className="k-table is-hover is-stack">
              <thead>
                <tr>
                  {["School", "Subject", "Category", "Status", "Last Message"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {messages.map((msg) => (
                  <tr key={msg.id} onClick={() => setOpenTicketId(msg.id)} className="cursor-pointer">
                    <td className="is-title">
                      {/* The whole row opens the ticket with a mouse; this real button is the keyboard and screen reader way in. */}
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenTicketId(msg.id); }} className="max-sm:min-h-[44px] text-left font-medium" aria-label={`Open ticket: ${msg.subject} (${msg.school_name})`}>{msg.school_name}</button>
                    </td>
                    <td data-label="Subject">{msg.subject}</td>
                    <td data-label="Category">{msg.category}</td>
                    <td data-label="Status">
                      <Pill tone={STATUS_TONE[msg.status] ?? "slate"}>{msg.status}</Pill>
                    </td>
                    <td data-label="Last Message" className="sm:max-w-xs sm:truncate">{msg.last_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={paging} onPageChange={goToPage} />
      </Section>
    </Page>
  );
}
