"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/Icon";

const EXT_BADGES = { pdf: "PDF", doc: "DOC", docx: "DOC", xls: "XLS", xlsx: "XLS", ppt: "PPT", pptx: "PPT" };
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

function extOf(name) {
  return name?.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
}

/**
 * A file opened inside the app instead of a raw new tab, so there is always a close button
 * (a new tab has no way back on a phone). Images show inline, PDFs in a frame, anything else
 * falls back to a badge with Download. `file` is { url, name, type?, subtitle? }.
 */
export function FileViewer({ file, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file?.url) return null;

  const ext = extOf(file.name) || extOf(file.url);
  const isImage = file.type?.startsWith("image/") || IMAGE_EXTS.includes(ext);
  const isPdf = file.type === "application/pdf" || ext === "pdf";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={file.name ?? "File"}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{file.name ?? "File"}</p>
            {file.subtitle && <p className="mt-0.5 truncate text-xs text-slate-400">{file.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 max-sm:h-[44px] max-sm:w-[44px]"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="flex min-h-[40vh] flex-1 items-center justify-center overflow-auto bg-slate-50 p-3 sm:p-4">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt={file.name ?? "File"} className="max-h-[68vh] w-auto max-w-full rounded-xl object-contain shadow-sm" />
          ) : isPdf ? (
            <iframe src={file.url} title={file.name ?? "File"} className="h-[68vh] w-full rounded-xl border border-slate-200 bg-white" />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-sm font-bold text-slate-500">{EXT_BADGES[ext] ?? "FILE"}</span>
              <p className="text-sm text-slate-500">Preview isn&apos;t available for this file type — download it to open.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 max-sm:min-h-[44px]">
            Close
          </button>
          <a href={file.url} download={file.name} className="grid place-items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 max-sm:min-h-[44px]">
            Download
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Drop-in replacement for `<a href target="_blank">`: same look (pass className), opens the viewer on click. */
export default function FileLink({ url, name, type, subtitle, className, children, ...rest }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={className} {...rest}>
        {children}
      </button>
      {open && <FileViewer file={{ url, name, type, subtitle }} onClose={() => setOpen(false)} />}
    </>
  );
}
