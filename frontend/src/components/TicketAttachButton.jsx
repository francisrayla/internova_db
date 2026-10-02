"use client";

import { useRef } from "react";
import Icon from "@/components/Icon";

// Icon-only, no inline chip — used in a ticket thread's reply row, where it
// sits directly beside the input like an ordinary chat composer's paperclip,
// instead of on its own row where it can end up crowded against whatever
// else floats at the corner of the viewport.
export function AttachIconButton({ onPick, disabled }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onPick(picked);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        aria-label="Attach a file"
        title="Attach a file"
      >
        <Icon name="paperclip" size={16} />
      </button>
    </>
  );
}

export function FileChip({ file, onRemove }) {
  if (!file) return null;
  return (
    <span className="flex items-center gap-1.5 self-start truncate rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
      <span className="truncate">{file.name}</span>
      <button type="button" onClick={onRemove} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label="Remove attachment">
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

// The button + its own inline chip, for a labeled field with room to spare
// (e.g. NewTicketForm's "Attachment" field) — the reply row instead composes
// AttachIconButton and FileChip separately so the chip can sit above the row.
export default function AttachButton({ file, onPick, onRemove, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <AttachIconButton onPick={onPick} disabled={disabled} />
      <FileChip file={file} onRemove={onRemove} />
    </div>
  );
}
