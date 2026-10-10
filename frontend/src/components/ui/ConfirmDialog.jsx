"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation for risky actions. Say what will happen in `children`.
 * Focus starts on Cancel (the safe choice), Tab stays inside the dialog,
 * Escape cancels, and focus returns to whatever opened it.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger", busy = false, error = "", onConfirm, onCancel }) {
  const panelRef = useRef(null);
  const cancelRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const cancelHandler = useRef(onCancel);
  useEffect(() => {
    cancelHandler.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    cancelRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelHandler.current?.();
      } else if (e.key === "Tab") {
        const nodes = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) ?? []);
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
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const confirmClass = tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700";

  return (
    <div className="sheet-overlay fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="sheet-panel w-full max-w-md rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:rounded-3xl sm:p-6">
        <h3 id={titleId} className="text-base font-semibold text-slate-900">{title}</h3>
        <div id={descId} className="mt-2 space-y-2 text-sm text-slate-600">{children}</div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 max-sm:min-h-[44px]">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 max-sm:min-h-[44px] ${confirmClass}`}>
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
