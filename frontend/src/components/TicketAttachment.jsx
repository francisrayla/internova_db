"use client";

import Icon from "@/components/Icon";
import FileLink from "@/components/FileViewer";
import { formatBytes } from "@/lib/format";

/** Renders a support-ticket message's attachment the same way whether it's
 * being viewed by the coordinator who sent it or the Super Admin reading it —
 * an inline thumbnail for images, a file chip (name + size) for anything
 * else, both opening the original in a new tab. */
export default function TicketAttachment({ url, name, type, size, mine }) {
  if (!url) return null;
  const isImage = type?.startsWith("image/");

  if (isImage) {
    return (
      <FileLink url={url} name={name} type={type} className="block w-full cursor-zoom-in overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name || "Attachment"} className="max-h-56 w-full object-cover" />
      </FileLink>
    );
  }

  return (
    <FileLink
      url={url}
      name={name}
      type={type}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${
        mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-slate-50"
      }`}
    >
      <Icon name="file" size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name || "File"}</span>
        {size != null && <span className="block opacity-75">{formatBytes(size)}</span>}
      </span>
    </FileLink>
  );
}
