"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getEcho } from "@/lib/echo";
import Icon from "@/components/Icon";
import FileLink from "@/components/FileViewer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { apiFetch } from "@/lib/apiFetch";
import { MAX_ATTACHMENT_BYTES, validateAttachmentFile } from "@/lib/imageValidation";

import { inputProps } from "@/lib/inputRules";
import { initialsOf, formatBytes } from "@/lib/format";
const ROLE_LABELS = { coordinator: "Coordinator", supervisor: "Supervisor", intern: "Intern" };
// The school's head is shown with the title the school picked (Dean / Principal / School Head),
// which the API sends as role_label; the word in ROLE_LABELS is only a fallback.
const roleLabelOf = (c) => c?.role_label ?? ROLE_LABELS[c?.role] ?? "";
// Name as shown in the chat list and header: the head gets "Maria Reyes · Principal".
const displayNameOf = (c) => (c?.type !== "group" && c?.role === "dean" ? `${c.name} · ${roleLabelOf(c)}` : c?.name);
const MAX_OPEN_CHATS = 3;
// Messages loaded when a chat opens, and per "Load earlier messages" click.
const THREAD_PAGE = 30;
// Only a coordinator/supervisor starts a group (see backend
// MessageController::createGroup) — once it exists, every member added,
// interns included, can read and post in it like anyone else.
const GROUP_CREATOR_ROLES = ["supervisor", "coordinator"];
const DEFAULT_CHAT_COLOR = "#2563eb";
const CHAT_COLORS = [
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#9333ea" },
  { label: "Pink", value: "#db2777" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Green", value: "#16a34a" },
  { label: "Teal", value: "#0d9488" },
  { label: "Slate", value: "#475569" },
];

// Mirrors the backend's previewLabel() — a one-line stand-in for a message
// with no text of its own, used for the reply banner and the quoted strip
// above a reply.
function messagePreview(m) {
  if (!m) return "";
  if (m.message) return m.message;
  if (m.attachment_url) {
    return m.attachment_type?.startsWith("image/") ? "Photo" : (m.attachment_name || "File");
  }
  return "";
}

// A DM shows the other person's real photo when they have one; a group
// always shows the group icon (no single "group photo" concept here, same
// simplification Messenger itself falls back to for unnamed/un-photographed
// group chats).
function AvatarContent({ conversation, iconSize }) {
  if (conversation.type !== "group" && conversation.avatar_url) {
    return <img src={conversation.avatar_url} alt="" className="h-full w-full object-cover" />;
  }
  return conversation.type === "group" ? <Icon name="users" size={iconSize} /> : initialsOf(conversation.name);
}

// A DM is keyed by the other user's id, a group by its own id — both are
// just numbers, so without the type prefix a dm and a group could collide
// on the same key (e.g. contact id 3 and group id 3).
function keyOf(conversation) {
  return `${conversation.type}-${conversation.id}`;
}

// Below Tailwind's `sm` (640px) the messenger is a full-screen, Messenger-app
// style experience (chat list, then one conversation); from `sm` up it is the
// docked widget. useSyncExternalStore reads the media query on the very first
// client render, so nothing flashes in the wrong layout.
const PHONE_QUERY = "(max-width: 639.98px)";
function subscribePhone(callback) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

// One row of the chat list. The desktop dropdown keeps its compact row; on a
// phone the row is a big tap target: 48px avatar, name, role label, last
// message, time and unread badge.
function ConversationRow({ c, phone, onOpen }) {
  const isGroup = c.type === "group";
  const unsentLast = Boolean(c.last_message_unsent);
  const preview = c.last_message
    ? `${unsentLast ? "" : c.last_message_from_me ? "You: " : isGroup && c.last_message_sender_name ? `${c.last_message_sender_name}: ` : ""}${c.last_message}`
    : isGroup
      ? `${c.members?.length ?? 0} members`
      : roleLabelOf(c);

  if (phone) {
    // The head's name already carries the title ("Maria · Principal").
    const roleLine = isGroup ? `${c.members?.length ?? 0} members` : c.role === "dean" ? "" : roleLabelOf(c);
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-h-[76px] w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left active:bg-slate-100 ${
          c.unread_count > 0 ? "bg-blue-50/50" : ""
        }`}
      >
        <span
          className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold ${
            isGroup ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          <AvatarContent conversation={c} iconSize={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`flex min-w-0 items-center gap-1 text-base ${c.unread_count > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
              <span className="truncate">{displayNameOf(c)}</span>
              {c.muted && <Icon name="bellOff" size={13} className="shrink-0 text-slate-400" />}
            </p>
            {c.last_message_at && <span className="shrink-0 text-xs text-slate-500">{c.last_message_at}</span>}
          </div>
          {roleLine && <p className="truncate text-xs text-slate-500">{roleLine}</p>}
          {c.last_message && (
            <p className={`truncate text-sm ${unsentLast ? "italic" : ""} ${c.unread_count > 0 ? "font-medium text-slate-800" : "text-slate-500"}`}>{preview}</p>
          )}
        </div>
        {c.unread_count > 0 && (
          <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
            {c.unread_count > 9 ? "9+" : c.unread_count}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${
        c.unread_count > 0 ? "bg-blue-50/50" : ""
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${
          isGroup ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
        }`}
      >
        <AvatarContent conversation={c} iconSize={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`flex min-w-0 items-center gap-1 truncate text-sm ${c.unread_count > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
            <span className="truncate">{displayNameOf(c)}</span>
            {c.muted && <Icon name="bellOff" size={11} className="shrink-0 text-slate-400" />}
          </p>
          {c.last_message_at && <span className="shrink-0 text-[11px] text-slate-400">{c.last_message_at}</span>}
        </div>
        <p className={`truncate text-xs text-slate-500 ${unsentLast ? "italic" : ""}`}>{preview}</p>
      </div>
      {c.unread_count > 0 && (
        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
          {c.unread_count > 9 ? "9+" : c.unread_count}
        </span>
      )}
    </button>
  );
}

// Minimized down to just a round avatar bubble docked at the edge — hover
// it to see who it is (matches Facebook's own minimized chat heads), click
// to restore, or catch the small × that appears on hover to close it
// outright without ever re-opening the window.
function MinimizedBubble({ conversation, onRestore, onClose }) {
  const isGroup = conversation.type === "group";
  const activeColor = conversation.color || (isGroup ? "#9333ea" : DEFAULT_CHAT_COLOR);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onRestore}
        style={{ backgroundColor: activeColor }}
        className="grid h-12 w-12 place-items-center overflow-hidden rounded-full text-sm font-bold text-white shadow-lg ring-2 ring-white hover:brightness-110"
        aria-label={`Expand chat with ${conversation.name}`}
      >
        <AvatarContent conversation={conversation} iconSize={18} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-900 group-hover:flex"
        aria-label={`Close chat with ${conversation.name}`}
      >
        <Icon name="x" size={11} />
      </button>
      <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {conversation.name}
      </span>
    </div>
  );
}

// A single floating window, Messenger-style — docked to the bottom of the
// viewport rather than a full page, so chatting never interrupts whatever
// screen the conversation started from. Works for both a 1:1 conversation
// and a group (sender names above bubbles, member count in the subtitle).
function ChatWindow({ conversation, messages, loading, hasMore, loadingEarlier, onLoadEarlier, isTyping, typingName, onSend, onSendFile, onTyping, onClose, onToggleMinimize, onToggleMute, onSetColor, onForward, onUnsend, forwardTargets, currentUserId, phone = false, onBack }) {
  const [text, setText] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingId, setForwardingId] = useState(null);
  const [forwardError, setForwardError] = useState("");
  const [detailsMessage, setDetailsMessage] = useState(null);
  const [unsendingId, setUnsendingId] = useState(null);
  const [unsendBusy, setUnsendBusy] = useState(false);
  const [unsendError, setUnsendError] = useState("");
  const listRef = useRef(null);
  const optionsRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageMenuRef = useRef(null);
  const isGroup = conversation.type === "group";
  const activeColor = conversation.color || (isGroup ? "#9333ea" : DEFAULT_CHAT_COLOR);

  // Older messages are added above the ones on screen: keep the reader where they were instead of jumping to the bottom.
  const keepScrollRef = useRef(null);
  useLayoutEffect(() => {
    if (!listRef.current) return;
    if (keepScrollRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight - keepScrollRef.current;
      keepScrollRef.current = null;
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isTyping]);

  function loadEarlier() {
    keepScrollRef.current = listRef.current ? listRef.current.scrollHeight : null;
    onLoadEarlier();
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (optionsRef.current && !optionsRef.current.contains(e.target)) setShowOptions(false);
      if (messageMenuRef.current && !messageMenuRef.current.contains(e.target) && !e.target.closest?.("[data-msg-menu-toggle]")) setOpenMenuId(null);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpenMenuId(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, replyingTo?.id);
    setText("");
    setReplyingTo(null);
  }

  async function handleFilePick(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const validationError = validateAttachmentFile(picked, MAX_ATTACHMENT_BYTES);
    if (validationError) {
      setAttachError(validationError);
      return;
    }
    setAttachError("");
    setUploading(true);
    try {
      await onSendFile(picked, text.trim(), replyingTo?.id);
      setText("");
      setReplyingTo(null);
    } finally {
      setUploading(false);
    }
  }

  function startReply(m) {
    setReplyingTo({ id: m.id, sender_name: mineName(m) ? "You" : (m.sender_name ?? conversation.name), preview: messagePreview(m) });
    setOpenMenuId(null);
  }

  function mineName(m) {
    return m.sender_id === currentUserId;
  }

  // The attachment lives on the Laravel origin, which the browser can't
  // fetch() directly (no CORS on /storage there, and it's not meant to be
  // reachable from the browser at all — every other call in this app goes
  // through a same-origin Next.js proxy). Route the download through our
  // own /api/download proxy instead, which streams it back with a real
  // Content-Disposition: attachment header.
  async function handleSave(m) {
    setOpenMenuId(null);
    try {
      const path = new URL(m.attachment_url).pathname.replace(/^\//, "");
      const proxyUrl = `/api/download?path=${encodeURIComponent(path)}&name=${encodeURIComponent(m.attachment_name || "download")}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.attachment_name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(m.attachment_url, "_blank");
    }
  }

  async function handleUnsend() {
    setUnsendBusy(true);
    setUnsendError("");
    try {
      await onUnsend(unsendingId);
      setUnsendingId(null);
    } catch (err) {
      setUnsendError(err.message || "Could not unsend this message.");
    } finally {
      setUnsendBusy(false);
    }
  }

  async function handleForwardTo(target) {
    setForwardError("");
    try {
      await onForward(forwardingId, target);
      setForwardingId(null);
    } catch (err) {
      setForwardError(err.message || "Could not forward this message.");
    }
  }

  return (
    <div className={phone ? "relative flex h-full w-full min-w-0 flex-col bg-white" : "relative flex h-[26rem] w-72 max-w-[calc(100vw-2rem)] flex-col border border-slate-200 bg-white shadow-2xl"}>
      <div className="relative shrink-0" ref={optionsRef}>
        {phone ? (
          <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-1 py-1.5">
            <button
              type="button"
              onClick={onBack}
              className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full text-slate-700 active:bg-slate-100"
              aria-label="Back to chats"
            >
              <Icon name="arrow" size={22} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl py-0.5 text-left"
            >
              <span
                style={{ backgroundColor: activeColor }}
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold text-white"
              >
                <AvatarContent conversation={conversation} iconSize={18} />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-base font-semibold leading-tight text-slate-900">
                  <span className="truncate">{displayNameOf(conversation)}</span>
                  {conversation.muted && <Icon name="bellOff" size={13} className="shrink-0 text-slate-500" />}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {isGroup ? `${conversation.members?.length ?? 0} members` : roleLabelOf(conversation)}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full text-slate-700 active:bg-slate-100"
              aria-label="Conversation options"
              aria-expanded={showOptions}
            >
              <Icon name="dots" size={20} />
            </button>
          </div>
        ) : (
        <div
          onClick={onToggleMinimize}
          style={{ backgroundColor: activeColor }}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-t-2xl px-3 py-2.5 text-white"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowOptions((v) => !v); }}
            className="flex min-w-0 items-center gap-2 rounded-lg py-0.5 pl-0.5 pr-1.5 text-left hover:bg-white/10"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/20 text-xs font-bold">
              <AvatarContent conversation={conversation} iconSize={14} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-sm font-semibold leading-tight">
                {displayNameOf(conversation)}
                {conversation.muted && <Icon name="bellOff" size={11} className="shrink-0 text-white/70" />}
              </p>
              <p className="truncate text-[11px] text-white/80">
                {isGroup ? `${conversation.members?.length ?? 0} members` : roleLabelOf(conversation)}
              </p>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
              className="rounded-lg px-1.5 py-1 text-lg leading-none hover:bg-white/10"
              aria-label={`Minimize chat with ${conversation.name}`}
            >
              −
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="rounded-lg p-1 hover:bg-white/10"
              aria-label={`Close chat with ${conversation.name}`}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
        )}

        {showOptions && (
          <div className={`absolute z-20 mt-1 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl ${phone ? "right-2 top-full w-64" : "left-2 top-full w-52"}`}>
            <button
              type="button"
              onClick={() => { onToggleMute(); setShowOptions(false); }}
              className={`flex w-full items-center gap-2.5 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px]" : "py-2"}`}
            >
              <Icon name="bellOff" size={15} /> {conversation.muted ? "Unmute conversation" : "Mute conversation"}
            </button>
            <button
              type="button"
              onClick={() => { setShowMedia(true); setShowOptions(false); }}
              className={`flex w-full items-center gap-2.5 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px]" : "py-2"}`}
            >
              <Icon name="file" size={15} /> Shared photos &amp; files
            </button>
            <div className="my-1 border-t border-slate-100" />
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Chat color</p>
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {CHAT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => { onSetColor(c.value); setShowOptions(false); }}
                  title={c.label}
                  aria-label={`Set chat color to ${c.label}`}
                  className={`grid place-items-center rounded-full border-2 ${phone ? "h-8 w-8" : "h-6 w-6"} ${
                    activeColor === c.value ? "border-slate-900" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                >
                  {activeColor === c.value && <Icon name="check" size={12} className="text-white" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {forwardingId ? (
        <ForwardPicker
          targets={forwardTargets}
          error={forwardError}
          onPick={handleForwardTo}
          onBack={() => { setForwardingId(null); setForwardError(""); }}
        />
      ) : showMedia ? (
        <MediaGallery messages={messages} onBack={() => setShowMedia(false)} />
      ) : (
      <div ref={listRef} className={`flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3 ${phone ? "overscroll-contain" : ""}`}>
        {loading ? (
          <p className="mt-8 text-center text-xs text-slate-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-xs text-slate-400">
            {isGroup ? "No messages yet." : `Say hello to ${conversation.name.split(" ")[0]}.`}
          </p>
        ) : (
          <>
          {hasMore && (
            <div className="text-center">
              <button type="button" onClick={loadEarlier} disabled={loadingEarlier} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 max-sm:min-h-[44px]">
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {messages.map((m) => {
            if (m.is_system) {
              return (
                <p key={m.id} className="my-1 text-center text-[11px] text-slate-400">
                  {m.message}
                </p>
              );
            }
            const mine = m.sender_id === currentUserId;
            const isImageAttachment = m.attachment_url && m.attachment_type?.startsWith("image/");
            const isSent = typeof m.id === "number";
            const menuOpen = openMenuId === m.id;
            const menuButton = isSent && !m.unsent && (
              <div className="relative shrink-0 self-center">
                <button
                  type="button"
                  onClick={() => setOpenMenuId((v) => (v === m.id ? null : m.id))}
                  data-msg-menu-toggle
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={`grid ${phone ? "h-9 w-9" : "h-7 w-7"} place-items-center rounded-full text-slate-500 outline-none hover:bg-slate-200 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    menuOpen ? "bg-slate-200 text-slate-600" : "opacity-70 hover:opacity-100 focus-visible:opacity-100"
                  }`}
                  aria-label="Message actions"
                >
                  <Icon name="dots" size={13} />
                </button>
                {menuOpen && (
                  <div
                    ref={messageMenuRef}
                    role="menu"
                    className={`absolute top-full left-0 z-20 mt-1 rounded-xl border border-slate-200 bg-white py-1 shadow-xl ${phone ? "w-44" : "w-36"}`}
                  >
                    <button type="button" onClick={() => startReply(m)} className={`flex w-full items-center px-3 text-left text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px] text-sm" : "py-1.5 text-xs"}`}>
                      Reply
                    </button>
                    <button type="button" onClick={() => { setForwardingId(m.id); setOpenMenuId(null); }} className={`flex w-full items-center px-3 text-left text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px] text-sm" : "py-1.5 text-xs"}`}>
                      Forward
                    </button>
                    {mine && (
                      <button type="button" onClick={() => { setUnsendingId(m.id); setUnsendError(""); setOpenMenuId(null); }} className={`flex w-full items-center px-3 text-left text-red-600 hover:bg-red-50 ${phone ? "min-h-[44px] text-sm" : "py-1.5 text-xs"}`}>
                        Unsend
                      </button>
                    )}
                    {m.attachment_url && (
                      <button type="button" onClick={() => handleSave(m)} className={`flex w-full items-center px-3 text-left text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px] text-sm" : "py-1.5 text-xs"}`}>
                        Save
                      </button>
                    )}
                    <button type="button" onClick={() => { setDetailsMessage(m); setOpenMenuId(null); }} className={`flex w-full items-center px-3 text-left text-slate-700 hover:bg-slate-50 ${phone ? "min-h-[44px] text-sm" : "py-1.5 text-xs"}`}>
                      Details
                    </button>
                  </div>
                )}
              </div>
            );
            return (
              <div key={m.id} className={`group flex items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                {menuButton}
                <div className={phone ? "max-w-[82%]" : "max-w-[75%]"}>
                  {isGroup && !mine && <p className="mb-0.5 ml-1 text-[10px] font-semibold text-slate-500">{m.sender_name}</p>}
                  {m.unsent ? (
                    <div className={`break-words rounded-2xl border border-dashed border-slate-300 px-3 py-1.5 italic text-slate-400 ${phone ? "text-[15px]" : "text-sm"}`}>
                      {mine ? "You unsent a message" : `${(isGroup ? m.sender_name : conversation.name)?.split(" ")[0] ?? "They"} unsent a message`}
                    </div>
                  ) : (
                  <div
                    className={`break-words rounded-2xl px-3 py-1.5 ${phone ? "text-[15px]" : "text-sm"} ${
                      mine ? "text-white" : "border border-slate-200 bg-white text-slate-800"
                    } ${m.attachment_url || m.reply_to ? "space-y-1.5" : ""} ${
                      // A one-word message ("hahaha") hugs its own text so
                      // tightly that a 16px radius reads as a full pill/oval
                      // instead of a rounded rectangle — a minimum width
                      // gives short bubbles enough straight edge to look like
                      // the same shape as longer ones. Skipped for
                      // attachments, which already have their own natural
                      // width from the image/file row.
                      !m.attachment_url ? "min-w-16" : ""
                    }`}
                    style={mine ? { backgroundColor: activeColor } : undefined}
                  >
                    {m.reply_to && (
                      <div className={`-mx-1 rounded-lg border-l-2 px-2 py-1 text-xs ${mine ? "border-white/50 bg-white/10" : "border-slate-300 bg-slate-50"}`}>
                        <p className="font-semibold opacity-90">{m.reply_to.sender_name}</p>
                        <p className={`truncate opacity-75 ${m.reply_to.unsent ? "italic" : ""}`}>{m.reply_to.unsent ? "Message unsent" : m.reply_to.preview}</p>
                      </div>
                    )}
                    {isImageAttachment && (
                      <FileLink url={m.attachment_url} name={m.attachment_name} type="image/jpeg" className="-mx-3 -mt-1.5 block cursor-zoom-in overflow-hidden rounded-t-2xl first:rounded-t-2xl">
                        <img src={m.attachment_url} alt={m.attachment_name || "Attachment"} className="max-h-48 w-full object-cover" />
                      </FileLink>
                    )}
                    {m.attachment_url && !isImageAttachment && (
                      <FileLink
                        url={m.attachment_url}
                        name={m.attachment_name}
                        className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs ${
                          mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <Icon name="file" size={16} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.attachment_name || "File"}</span>
                          {m.attachment_size != null && <span className="block opacity-75">{formatBytes(m.attachment_size)}</span>}
                        </span>
                      </FileLink>
                    )}
                    {m.message && <div>{m.message}</div>}
                  </div>
                  )}
                  {m.created_at && <p className={`mt-0.5 px-1 text-[10px] text-slate-400 ${mine ? "text-right" : ""}`}>{m.created_at}</p>}
                </div>
              </div>
            );
          })}
          </>
        )}
        {isTyping && (
          <div className="flex justify-start">
            <div className="max-w-[75%]">
              {isGroup && typingName && <p className="mb-0.5 ml-1 text-[10px] font-semibold text-slate-500">{typingName}</p>}
              <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {replyingTo && (
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5">
          <div className="min-w-0 flex-1 border-l-2 border-slate-400 pl-2">
            <p className="text-[11px] font-semibold text-slate-600">Replying to {replyingTo.sender_name}</p>
            <p className="truncate text-[11px] text-slate-500">{replyingTo.preview}</p>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-200" aria-label="Cancel reply">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      {attachError && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{attachError}</p>
      )}
      <form onSubmit={handleSubmit} className={`flex shrink-0 items-center border-t bg-white ${phone ? "gap-1 border-slate-200 px-1.5 py-1.5" : "gap-1.5 border-slate-100 p-2"}`}>
        <input ref={fileInputRef} type="file" onChange={handleFilePick} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ color: activeColor }}
          className={`grid shrink-0 place-items-center rounded-full hover:bg-slate-100 disabled:opacity-40 ${phone ? "h-[44px] w-[44px]" : "h-8 w-8"}`}
          aria-label="Attach a photo or file"
          title="Attach a photo or file"
        >
          {uploading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Icon name="paperclip" size={phone ? 21 : 16} />
          )}
        </button>
        <input {...inputProps("message")}
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping(); }}
          placeholder="Aa"
          className={`min-w-0 flex-1 rounded-full bg-slate-100 outline-none focus:bg-slate-200 ${phone ? "h-[44px] px-4 text-base" : "px-3.5 py-2 text-sm"}`}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{ color: activeColor }}
          className={`grid shrink-0 place-items-center rounded-full hover:bg-slate-100 disabled:opacity-30 ${phone ? "h-[44px] w-[44px]" : "h-8 w-8"}`}
          aria-label="Send message"
        >
          <Icon name="send" size={phone ? 21 : 16} />
        </button>
      </form>

      <ConfirmDialog
        open={unsendingId !== null}
        title="Unsend this message?"
        confirmLabel="Unsend"
        busy={unsendBusy}
        error={unsendError}
        onConfirm={handleUnsend}
        onCancel={() => { setUnsendingId(null); setUnsendError(""); }}
      >
        <p>It will be removed for everyone in this conversation.</p>
      </ConfirmDialog>

      {detailsMessage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setDetailsMessage(null)}>
          <div className="w-full max-w-[15rem] rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Message details</p>
              <button type="button" onClick={() => setDetailsMessage(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Close details">
                <Icon name="x" size={14} />
              </button>
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="font-semibold text-slate-500">From</dt>
                <dd className="text-slate-700">{detailsMessage.sender_id === currentUserId ? "You" : (detailsMessage.sender_name ?? conversation.name)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Sent</dt>
                <dd className="text-slate-700">{detailsMessage.created_at_full ?? detailsMessage.created_at}</dd>
              </div>
              {!isGroup && detailsMessage.sender_id === currentUserId && (
                <div>
                  <dt className="font-semibold text-slate-500">Status</dt>
                  <dd className="text-slate-700">{detailsMessage.read_at ? `Read ${detailsMessage.read_at}` : "Sent, not yet read"}</dd>
                </div>
              )}
              {detailsMessage.attachment_name && (
                <div>
                  <dt className="font-semibold text-slate-500">Attachment</dt>
                  <dd className="truncate text-slate-700">{detailsMessage.attachment_name}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every photo/file shared in this conversation, pulled straight from the
 * already-loaded message list — no separate endpoint needed, since the
 * messages (and their attachment fields) are already in memory. Sized and
 * positioned identically to the message list it temporarily replaces, so
 * switching in and out doesn't resize the window.
 */
function MediaGallery({ messages, onBack }) {
  const photos = messages.filter((m) => m.attachment_url && m.attachment_type?.startsWith("image/"));
  const files = messages.filter((m) => m.attachment_url && !m.attachment_type?.startsWith("image/"));

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={onBack} className="grid place-items-center rounded-lg p-1 text-slate-500 hover:bg-slate-100 max-sm:h-[44px] max-sm:w-[44px]" aria-label="Back to conversation">
          <Icon name="arrow" size={16} className="rotate-180" />
        </button>
        <p className="text-sm font-semibold text-slate-800">Shared photos &amp; files</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {photos.length === 0 && files.length === 0 ? (
          <p className="mt-8 text-center text-xs text-slate-400">Nothing shared here yet.</p>
        ) : (
          <>
            {photos.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Photos</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {photos.map((m) => (
                    <FileLink key={m.id} url={m.attachment_url} name={m.attachment_name} type="image/jpeg" className="block aspect-square cursor-zoom-in overflow-hidden rounded-lg">
                      <img src={m.attachment_url} alt={m.attachment_name || "Shared photo"} className="h-full w-full object-cover" />
                    </FileLink>
                  ))}
                </div>
              </div>
            )}
            {files.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Files</p>
                <div className="space-y-1.5">
                  {files.map((m) => (
                    <FileLink
                      key={m.id}
                      url={m.attachment_url}
                      name={m.attachment_name}
                      className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left text-xs hover:bg-slate-50"
                    >
                      <Icon name="file" size={16} className="shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-700">{m.attachment_name || "File"}</span>
                        {m.attachment_size != null && <span className="block text-slate-400">{formatBytes(m.attachment_size)}</span>}
                      </span>
                    </FileLink>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Where to send a forwarded message — every other open-able conversation
 * (every DM contact plus every group this viewer belongs to), sized and
 * positioned like MediaGallery so it swaps in over the message list rather
 * than opening yet another window.
 */
function ForwardPicker({ targets, error, onPick, onBack }) {
  const [query, setQuery] = useState("");
  const [sendingKey, setSendingKey] = useState(null);
  const filtered = targets.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function handlePick(t) {
    setSendingKey(keyOf(t));
    try {
      await onPick(t);
    } finally {
      setSendingKey(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={onBack} className="grid place-items-center rounded-lg p-1 text-slate-500 hover:bg-slate-100 max-sm:h-[44px] max-sm:w-[44px]" aria-label="Back to conversation">
          <Icon name="arrow" size={16} className="rotate-180" />
        </button>
        <p className="text-sm font-semibold text-slate-800">Forward to…</p>
      </div>
      <div className="border-b border-slate-100 bg-white p-2">
        <input {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people or groups…"
          className="w-full rounded-full bg-slate-100 px-3 py-1.5 text-xs outline-none focus:bg-slate-200 max-sm:h-[44px] max-sm:px-4 max-sm:text-base"
          autoFocus
        />
      </div>
      {error && <p className="bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{error}</p>}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="mt-8 text-center text-xs text-slate-400">No matches.</p>
        ) : (
          filtered.map((t) => (
            <button
              key={keyOf(t)}
              type="button"
              onClick={() => handlePick(t)}
              disabled={sendingKey === keyOf(t)}
              className="flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left hover:bg-white disabled:opacity-50 max-sm:min-h-[56px]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                <AvatarContent conversation={t} iconSize={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.name}</span>
              {sendingKey === keyOf(t) && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// Same chip-picker pattern as the supervisor's "Assign task" intern picker
// and the leader's subtask assignee picker — pick from the same people 1:1
// messaging already allows, becoming chips that drop out of the dropdown
// once selected.
function CreateGroupModal({ candidates, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    function handleClickOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Proper modal behaviour: Escape closes, Tab stays inside, the page behind
  // does not scroll, and focus goes back to what opened it.
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current?.();
      } else if (e.key === "Tab") {
        const nodes = Array.from(panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, []);

  const selectedPeople = candidates.filter((c) => selectedIds.includes(c.id));
  const filtered = candidates.filter((c) => !selectedIds.includes(c.id) && c.name.toLowerCase().includes(query.trim().toLowerCase()));

  function addMember(id) {
    setSelectedIds((prev) => [...prev, id]);
    setQuery("");
  }
  function removeMember(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }

  async function handleCreate() {
    // The creator is auto-added as a member server-side, so a group needs at
    // least 2 people picked here to reach the 3-member minimum overall.
    if (selectedIds.length < 2) {
      setError("A group needs at least 3 members — add at least 2 people.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/messages/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, member_ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not create the group.");
      onCreated(data.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-overlay fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="new-group-title" className="sheet-panel w-full max-w-md rounded-t-3xl bg-white p-5 pb-8 shadow-2xl sm:rounded-3xl sm:p-6">
        <h3 id="new-group-title" className="text-lg font-semibold text-slate-900">New group chat</h3>
        <p className="mt-1 text-xs text-slate-500">Add people from your interns, supervisors, or coordinators.</p>

        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Group name (optional)</span>
            <input {...inputProps("shortText")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OJT Batch 2026"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Members</span>
            <div className="relative" ref={pickerRef}>
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 p-2 focus-within:border-blue-500">
                {selectedPeople.map((p) => (
                  <span key={p.id} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                    {p.name}
                    <button type="button" onClick={() => removeMember(p.id)} className="text-blue-500 hover:text-blue-800" aria-label={`Remove ${p.name}`}>
                      ×
                    </button>
                  </span>
                ))}
                <input {...inputProps("search")}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }}
                  onFocus={() => setPickerOpen(true)}
                  placeholder={selectedPeople.length === 0 ? "Search people…" : "Add another…"}
                  className="min-w-[100px] flex-1 border-none px-1 py-0.5 text-sm outline-none"
                />
              </div>
              {pickerOpen && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {candidates.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">No one to add yet.</p>
                  ) : filtered.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">{selectedPeople.length === candidates.length ? "Everyone's added." : "No matches."}</p>
                  ) : (
                    filtered.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => addMember(c.id)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50"
                      >
                        <span>{c.name}</span>
                        <span className="text-xs text-slate-400">{roleLabelOf(c)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedIds.length < 2 && (
              <p className="mt-1.5 text-xs text-slate-400">
                Groups need at least 3 members total — add {2 - selectedIds.length} more.
              </p>
            )}
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create group"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Header messages icon + dropdown conversation list (1:1 and group) +
 * floating chat windows — the whole thing is self-contained so any layout
 * only has to render <MessengerWidget currentUser={user} /> once, next to
 * the notification bell. Real-time delivery reuses the same private-channel
 * Echo/Reverb setup as NotificationBell (see backend App\Events\MessageSent
 * / GroupMessageSent / UserTyping / GroupUserTyping).
 */
export default function MessengerWidget({ currentUser }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [openChats, setOpenChats] = useState([]);
  const [minimizedIds, setMinimizedIds] = useState([]);
  const [threads, setThreads] = useState({});
  const [typingFrom, setTypingFrom] = useState({});
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Phone layout (< 640px): the list and one conversation are full screens.
  // `open` = the chat list is showing, `activeKey` = the conversation on top of it.
  const isPhone = useIsPhone();
  const [activeKey, setActiveKey] = useState(null);
  const histDepthRef = useRef(0); // history entries pushed by the messenger, so Back steps list <- conversation
  const uiRef = useRef({ isPhone: false, open: false, activeKey: null });
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const optimisticIdRef = useRef(0);
  const typingClearTimeoutsRef = useRef({});
  const lastTypingSentRef = useRef({});

  // The floating windows portal straight to <body> — rendering them inside
  // the header would put them under its backdrop-blur, which (per the CSS
  // spec) makes backdrop-filter establish a new containing block for any
  // position:fixed descendant, anchoring "fixed bottom-0" to the header's
  // own small box instead of the viewport. Portalling out of that subtree
  // is what makes bottom-0 actually mean the bottom of the screen.
  useEffect(() => setMounted(true), []);

  const loadConversations = useCallback(() => {
    if (!currentUser?.id) return Promise.resolve([]);
    return Promise.all([
      apiFetch("/api/messages/contacts").then((res) => res.json()).catch(() => ({ contacts: [] })),
      apiFetch("/api/messages/groups").then((res) => res.json()).catch(() => ({ groups: [] })),
    ]).then(([contactsData, groupsData]) => {
      const dms = (contactsData.contacts ?? []).map((c) => ({ ...c, type: "dm" }));
      const groups = groupsData.groups ?? [];
      const merged = [...dms, ...groups].sort((a, b) => b.last_message_at_sort - a.last_message_at_sort);
      setConversations(merged);
      return merged;
    });
  }, [currentUser?.id]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    uiRef.current = { isPhone, open, activeKey };
  });

  // The phone Back button (and the browser's) steps conversation -> list -> closed.
  useEffect(() => {
    function onPopState() {
      if (histDepthRef.current <= 0) return;
      histDepthRef.current -= 1;
      const ui = uiRef.current;
      if (ui.activeKey) {
        setActiveKey(null);
        setOpen(true);
      } else if (ui.open) {
        setOpen(false);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function pushLevel() {
    histDepthRef.current += 1;
    window.history.pushState({ messenger: histDepthRef.current }, "");
  }

  // One step back in the full-screen messenger: through history when we pushed
  // an entry (so the browser Back and the on-screen arrow agree), else directly.
  function stepBack() {
    if (histDepthRef.current > 0) {
      window.history.back();
    } else if (uiRef.current.activeKey) {
      setActiveKey(null);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  const phoneVisible = isPhone && (open || activeKey !== null);

  // The page behind a full-screen messenger must not scroll.
  useEffect(() => {
    if (!phoneVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phoneVisible]);

  // Escape (external keyboard) steps back, unless the New group sheet is on top (it handles Escape itself).
  useEffect(() => {
    if (!phoneVisible || showCreateGroup) return;
    function onKey(e) {
      if (e.key === "Escape") stepBack();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    function handleClickOutside(event) {
      // Full-screen on a phone: nothing is "outside", the arrow / X / Back close it.
      if (uiRef.current.isPhone) return;
      const insideRoot = rootRef.current?.contains(event.target);
      const insideMenu = menuRef.current?.contains(event.target);
      if (!insideRoot && !insideMenu) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // The panel used to be an `absolute right-0 w-80` child of the icon's own
  // small wrapper — fine on desktop where that icon sits near the screen's
  // right edge, but on mobile it's mid-header (theme toggle, bell, avatar
  // all share the row), so right-0 anchored the panel's right edge to the
  // icon instead of the viewport and the fixed 320px width bled off the
  // left side of the screen. Measuring the icon's real position and
  // clamping the panel's left offset keeps it fully on-screen regardless of
  // where the icon lands.
  useEffect(() => {
    if (!open) return;
    function computePosition() {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
      setMenuPos({ top: rect.bottom + 8, left, width });
    }
    computePosition();
    window.addEventListener("resize", computePosition);
    return () => window.removeEventListener("resize", computePosition);
  }, [open]);

  // An unsent message turns into a placeholder in place: its text and file are dropped from the
  // thread, and any reply quoting it switches to "Message unsent".
  const markUnsent = useCallback((key, id) => {
    setThreads((prev) => {
      const thread = prev[key];
      if (!thread) return prev;
      const messages = thread.messages.map((m) => {
        if (m.id === id) {
          return { ...m, unsent: true, message: "", attachment_url: null, attachment_name: null, attachment_type: null, attachment_size: null, reply_to: null };
        }
        return m.reply_to?.id === id ? { ...m, reply_to: { ...m.reply_to, unsent: true, preview: null } } : m;
      });
      return { ...prev, [key]: { ...thread, messages } };
    });
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    const echo = getEcho();
    if (!echo) return;

    const channelName = `user.${currentUser.id}.messages`;

    function appendToThread(key, message) {
      setThreads((prev) => {
        if (!prev[key]) return prev;
        return { ...prev, [key]: { ...prev[key], messages: [...prev[key].messages, message] } };
      });
    }

    function clearTyping(key) {
      setTypingFrom((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    }

    // Typing has no "stopped" signal of its own — each pulse just (re)starts
    // a 3s timer, and the indicator disappears on its own once the pulses stop.
    function startTypingTimer(key, name) {
      setTypingFrom((prev) => ({ ...prev, [key]: name || true }));
      clearTimeout(typingClearTimeoutsRef.current[key]);
      typingClearTimeoutsRef.current[key] = setTimeout(() => {
        setTypingFrom((prev) => ({ ...prev, [key]: false }));
      }, 3000);
    }

    function handleMessage(payload) {
      loadConversations();
      appendToThread(`dm-${payload.sender_id}`, payload);
      clearTyping(`dm-${payload.sender_id}`);
    }

    function handleTyping(payload) {
      startTypingTimer(`dm-${payload.sender_id}`, null);
    }

    function handleUnsent(payload) {
      markUnsent(`dm-${payload.sender_id}`, payload.id);
      loadConversations();
    }

    function handleGroupUnsent(payload) {
      markUnsent(`group-${payload.group_id}`, payload.id);
      loadConversations();
    }

    function handleGroupMessage(payload) {
      loadConversations();
      appendToThread(`group-${payload.group_id}`, payload);
      clearTyping(`group-${payload.group_id}`);
    }

    function handleGroupTyping(payload) {
      startTypingTimer(`group-${payload.group_id}`, payload.sender_name);
    }

    echo.private(channelName).listen(".message.sent", handleMessage);
    echo.private(channelName).listen(".user.typing", handleTyping);
    echo.private(channelName).listen(".group.message.sent", handleGroupMessage);
    echo.private(channelName).listen(".group.user.typing", handleGroupTyping);
    echo.private(channelName).listen(".message.unsent", handleUnsent);
    echo.private(channelName).listen(".group.message.unsent", handleGroupUnsent);

    return () => {
      echo.private(channelName).stopListening(".message.sent", handleMessage);
      echo.private(channelName).stopListening(".user.typing", handleTyping);
      echo.private(channelName).stopListening(".group.message.sent", handleGroupMessage);
      echo.private(channelName).stopListening(".group.user.typing", handleGroupTyping);
      echo.private(channelName).stopListening(".message.unsent", handleUnsent);
      echo.private(channelName).stopListening(".group.message.unsent", handleGroupUnsent);
    };
  }, [currentUser?.id, loadConversations, markUnsent]);

  useEffect(() => {
    const timeouts = typingClearTimeoutsRef.current;
    return () => Object.values(timeouts).forEach(clearTimeout);
  }, []);

  function toggleList() {
    if (isPhone) {
      if (!open) {
        pushLevel();
        setOpen(true);
      }
      return;
    }
    setOpen((v) => !v);
  }

  function openChat(conversation) {
    const key = keyOf(conversation);
    if (isPhone) {
      // The list stays underneath; Back returns to it.
      if (activeKey === null) pushLevel();
      setActiveKey(key);
    } else {
      setOpen(false);
    }
    setSearch("");
    setOpenChats((prev) => (prev.some((c) => keyOf(c) === key) ? prev : [conversation, ...prev].slice(0, MAX_OPEN_CHATS)));
    setMinimizedIds((prev) => prev.filter((k) => k !== key));

    if (!threads[key]) {
      setThreads((prev) => ({ ...prev, [key]: { messages: [], loading: true } }));
      // The newest 30 only; "Load earlier messages" fetches the rest a page at a time.
      apiFetch(`${threadUrl(conversation)}?limit=${THREAD_PAGE}`)
        .then((res) => res.json())
        .then((data) => setThreads((prev) => ({ ...prev, [key]: { messages: data.messages ?? [], loading: false, hasMore: Boolean(data.has_more) } })))
        .catch(() => setThreads((prev) => ({ ...prev, [key]: { messages: [], loading: false } })));
    }
    setConversations((prev) => prev.map((c) => (keyOf(c) === key ? { ...c, unread_count: 0 } : c)));
  }

  function threadUrl(conversation) {
    return conversation.type === "group" ? `/api/messages/groups/${conversation.id}` : `/api/messages/thread/${conversation.id}`;
  }

  // Prepends the page of messages before the oldest real one on screen.
  async function loadEarlier(conversation) {
    const key = keyOf(conversation);
    const oldest = (threads[key]?.messages ?? []).find((m) => typeof m.id === "number");
    if (!oldest || threads[key]?.loadingEarlier) return;
    setThreads((prev) => ({ ...prev, [key]: { ...prev[key], loadingEarlier: true } }));
    try {
      const res = await apiFetch(`${threadUrl(conversation)}?limit=${THREAD_PAGE}&before_id=${oldest.id}`);
      const data = await res.json();
      setThreads((prev) => {
        const have = new Set((prev[key]?.messages ?? []).map((m) => m.id));
        const older = (data.messages ?? []).filter((m) => !have.has(m.id));
        return { ...prev, [key]: { ...prev[key], messages: [...older, ...(prev[key]?.messages ?? [])], hasMore: Boolean(data.has_more), loadingEarlier: false } };
      });
    } catch {
      setThreads((prev) => ({ ...prev, [key]: { ...prev[key], loadingEarlier: false } }));
    }
  }

  function closeChat(key) {
    setOpenChats((prev) => prev.filter((c) => keyOf(c) !== key));
    setMinimizedIds((prev) => prev.filter((k) => k !== key));
  }

  function toggleMinimize(key) {
    setMinimizedIds((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Throttled — fires at most once every 1.5s per conversation while the
  // user keeps typing, so every keystroke doesn't hit the network. Only
  // ever invoked from the input's onChange (an event handler, not render),
  // so the timestamp read here is safe despite the lint rule's static check.
  function sendTyping(conversation) {
    const key = keyOf(conversation);
    // eslint-disable-next-line react-hooks/purity -- called from an event handler, never during render
    const now = Date.now();
    const last = lastTypingSentRef.current[key] ?? 0;
    if (now - last < 1500) return;
    lastTypingSentRef.current[key] = now;

    const url = conversation.type === "group" ? `/api/messages/groups/${conversation.id}/typing` : "/api/messages/typing";
    const body = conversation.type === "group" ? {} : { receiver_id: conversation.id };
    apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  }

  async function sendMessage(conversation, text, replyToId) {
    const key = keyOf(conversation);
    optimisticIdRef.current += 1;
    const optimisticId = `tmp-${optimisticIdRef.current}`;
    setThreads((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        messages: [...(prev[key]?.messages ?? []), { id: optimisticId, sender_id: currentUser.id, sender_name: currentUser.name, message: text }],
      },
    }));

    try {
      const url = conversation.type === "group" ? `/api/messages/groups/${conversation.id}/messages` : "/api/messages";
      const body = conversation.type === "group"
        ? { message: text, reply_to_id: replyToId ?? undefined }
        : { receiver_id: conversation.id, message: text, reply_to_id: replyToId ?? undefined };
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && data.message_data) {
        setThreads((prev) => ({
          ...prev,
          [key]: { ...prev[key], messages: prev[key].messages.map((m) => (m.id === optimisticId ? data.message_data : m)) },
        }));
        loadConversations();
      }
    } catch {
      // Best-effort — the optimistic bubble stays visible either way.
    }
  }

  // Same optimistic-then-reconcile flow as sendMessage, using a local blob
  // URL so the picture/file preview appears instantly instead of waiting on
  // the upload — swapped out for the real storage URL once the server
  // responds (or left as-is on failure, same best-effort posture as text).
  async function sendAttachment(conversation, file, caption, replyToId) {
    const key = keyOf(conversation);
    optimisticIdRef.current += 1;
    const optimisticId = `tmp-${optimisticIdRef.current}`;
    const localUrl = URL.createObjectURL(file);
    setThreads((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        messages: [
          ...(prev[key]?.messages ?? []),
          {
            id: optimisticId,
            sender_id: currentUser.id,
            sender_name: currentUser.name,
            message: caption || "",
            attachment_url: localUrl,
            attachment_name: file.name,
            attachment_type: file.type,
            attachment_size: file.size,
          },
        ],
      },
    }));

    try {
      const formData = new FormData();
      if (conversation.type !== "group") formData.append("receiver_id", String(conversation.id));
      if (caption) formData.append("message", caption);
      if (replyToId) formData.append("reply_to_id", String(replyToId));
      formData.append("attachment", file);

      const url = conversation.type === "group" ? `/api/messages/groups/${conversation.id}/messages` : "/api/messages";
      const res = await apiFetch(url, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.message_data) {
        setThreads((prev) => ({
          ...prev,
          [key]: { ...prev[key], messages: prev[key].messages.map((m) => (m.id === optimisticId ? data.message_data : m)) },
        }));
        loadConversations();
        URL.revokeObjectURL(localUrl);
      }
    } catch {
      // Best-effort — the optimistic bubble (with its local preview) stays visible either way.
    }
  }

  // The forwarded copy lands wherever the target conversation's own thread
  // is currently kept — appended locally if it's already open, otherwise it
  // just shows up next time that thread loads. No optimistic bubble here
  // (unlike sendMessage/sendAttachment): forwarding already has to round-trip
  // to the server to resolve the source message, so there's nothing to show
  // before that response arrives anyway.
  async function forwardMessage(sourceConversation, sourceMessageId, targetConversation) {
    const res = await apiFetch("/api/messages/forward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: sourceConversation.type === "group" ? "group" : "dm",
        source_id: sourceMessageId,
        target_type: targetConversation.type === "group" ? "group" : "dm",
        target_id: targetConversation.id,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not forward this message.");

    const targetKey = keyOf(targetConversation);
    setThreads((prev) =>
      prev[targetKey] ? { ...prev, [targetKey]: { ...prev[targetKey], messages: [...prev[targetKey].messages, data.message_data] } } : prev
    );
    loadConversations();
  }

  // Unsend one of my own messages; throws with the server's message so the confirm dialog can show it.
  async function unsendMessage(conversation, messageId) {
    const url = conversation.type === "group" ? `/api/messages/groups/${conversation.id}/messages/${messageId}` : `/api/messages/${messageId}`;
    const res = await apiFetch(url, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Could not unsend this message.");
    markUnsent(keyOf(conversation), messageId);
    loadConversations();
  }

  // Mute/color are per-viewer preferences (see backend MessageThreadSetting)
  // — applied optimistically to both lists an open conversation can appear
  // in, then persisted; a failed request just means the next full reload
  // (loadConversations) resyncs from the server instead of losing the change.
  function updateThreadSetting(conversation, patch) {
    const key = keyOf(conversation);
    setConversations((prev) => prev.map((c) => (keyOf(c) === key ? { ...c, ...patch } : c)));
    setOpenChats((prev) => prev.map((c) => (keyOf(c) === key ? { ...c, ...patch } : c)));
    apiFetch("/api/messages/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: conversation.type, id: conversation.id, ...patch }),
    }).catch(() => {});
  }

  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(q));
  }, [conversations, search]);
  const dmCandidatesForGroup = useMemo(() => conversations.filter((c) => c.type === "dm" && c.role !== "dean"), [conversations]);
  const canCreateGroup = GROUP_CREATOR_ROLES.includes(currentUser?.role);

  const activeChat = activeKey ? openChats.find((c) => keyOf(c) === activeKey) : null;

  function renderChat(c, phone) {
    const key = keyOf(c);
    return (
      <ChatWindow
        key={key}
        conversation={c}
        messages={threads[key]?.messages ?? []}
        loading={threads[key]?.loading ?? false}
        hasMore={threads[key]?.hasMore ?? false}
        loadingEarlier={threads[key]?.loadingEarlier ?? false}
        onLoadEarlier={() => loadEarlier(c)}
        isTyping={Boolean(typingFrom[key])}
        typingName={typeof typingFrom[key] === "string" ? typingFrom[key] : null}
        onSend={(text, replyToId) => sendMessage(c, text, replyToId)}
        onSendFile={(file, caption, replyToId) => sendAttachment(c, file, caption, replyToId)}
        onTyping={() => sendTyping(c)}
        onClose={() => closeChat(key)}
        onToggleMinimize={() => toggleMinimize(key)}
        onToggleMute={() => updateThreadSetting(c, { muted: !c.muted })}
        onSetColor={(color) => updateThreadSetting(c, { color })}
        onForward={(messageId, target) => forwardMessage(c, messageId, target)}
        onUnsend={(messageId) => unsendMessage(c, messageId)}
        forwardTargets={conversations.filter((t) => keyOf(t) !== key)}
        currentUserId={currentUser?.id}
        phone={phone}
        onBack={stepBack}
      />
    );
  }

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={toggleList}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 max-sm:h-11 max-sm:w-11"
          title="Messages"
          aria-label={unreadTotal > 0 ? `Messages, ${unreadTotal} unread` : "Messages"}
          aria-expanded={open}
        >
          <Icon name="message" size={18} />
          {unreadTotal > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadTotal > 9 ? "9+" : unreadTotal}
            </span>
          )}
        </button>

      </div>

      {mounted && open && (isPhone || menuPos) &&
        createPortal(
          isPhone ? (
            <div ref={menuRef} className={`msg-screen z-[60] flex-col bg-white ${activeKey !== null ? "hidden" : "flex"}`}>
              <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-2xl font-bold text-slate-900">Chats</p>
                  <div className="-mr-2 flex items-center gap-1">
                    {canCreateGroup && (
                      <button
                        type="button"
                        onClick={() => setShowCreateGroup(true)}
                        className="grid h-[44px] w-[44px] place-items-center rounded-full bg-slate-100 text-slate-700 active:bg-slate-200"
                        aria-label="New group"
                        title="New group"
                      >
                        <Icon name="plus" size={20} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={stepBack}
                      className="grid h-[44px] w-[44px] place-items-center rounded-full text-slate-700 active:bg-slate-100"
                      aria-label="Close chats"
                    >
                      <Icon name="x" size={22} />
                    </button>
                  </div>
                </div>
                <input {...inputProps("search")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people…"
                  className="h-[44px] w-full rounded-full border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {conversations.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">No one to message yet</p>
                ) : filteredConversations.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">No matches for &quot;{search}&quot;</p>
                ) : (
                  filteredConversations.map((c) => <ConversationRow key={keyOf(c)} c={c} phone onOpen={() => openChat(c)} />)
                )}
              </div>
            </div>
          ) : (
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="z-30 rounded-2xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Messages</p>
                {canCreateGroup && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setShowCreateGroup(true); }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    <Icon name="plus" size={12} /> New Group
                  </button>
                )}
              </div>
              <input {...inputProps("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>
            <div className="max-h-96 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">No one to message yet</p>
              ) : filteredConversations.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">No matches for &quot;{search}&quot;</p>
              ) : (
                filteredConversations.map((c) => <ConversationRow key={keyOf(c)} c={c} phone={false} onOpen={() => openChat(c)} />)
              )}
            </div>
          </div>
          ),
          document.body
        )}

      {mounted && isPhone && activeChat &&
        createPortal(
          <div className="msg-screen z-[60] flex flex-col bg-white">
            {renderChat(activeChat, true)}
          </div>,
          document.body
        )}

      {mounted && !isPhone &&
        createPortal(
          <>
            {/* Minimized chats stack in their own column, growing upward as
                more get tucked away, separate from the row of open windows
                below so restoring one doesn't reflow the whole stack. */}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse items-end gap-2">
              {openChats
                .filter((c) => minimizedIds.includes(keyOf(c)))
                .map((c) => (
                  <MinimizedBubble key={keyOf(c)} conversation={c} onRestore={() => toggleMinimize(keyOf(c))} onClose={() => closeChat(keyOf(c))} />
                ))}
            </div>

            <div className="no-scrollbar kb-lift fixed bottom-0 right-4 z-50 flex max-w-[100vw] items-end gap-3 overflow-x-auto sm:right-20">
              {openChats
                .filter((c) => !minimizedIds.includes(keyOf(c)))
                .map((c) => renderChat(c, false))}
            </div>
          </>,
          document.body
        )}

      {mounted &&
        showCreateGroup &&
        createPortal(
          <CreateGroupModal
            candidates={dmCandidatesForGroup}
            onClose={() => setShowCreateGroup(false)}
            onCreated={(groupId) => {
              setShowCreateGroup(false);
              loadConversations().then((list) => {
                const newGroup = list.find((c) => c.type === "group" && c.id === groupId);
                if (newGroup) openChat(newGroup);
              });
            }}
          />,
          document.body
        )}
    </>
  );
}
