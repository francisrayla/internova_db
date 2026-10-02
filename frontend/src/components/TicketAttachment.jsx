"use client";

import Icon from "@/components/Icon";

function formatBytes(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a support-ticket message's attachment the same way whether it's
 * being viewed by the coordinator who sent it or the Super Admin reading it —
 * an inline thumbnail for images, a file chip (name + size) for anything
 * else, both opening the original in a new tab. */
export default function TicketAttachment({ url, name, type, size, mine }) {
  if (!url) return null;
  const isImage = type?.startsWith("image/");

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name || "Attachment"} className="max-h-56 w-full object-cover" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
        mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-slate-50"
      }`}
    >
      <Icon name="file" size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name || "File"}</span>
        {size != null && <span className="block opacity-75">{formatBytes(size)}</span>}
      </span>
    </a>
  );
}
