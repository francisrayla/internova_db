"use client";

const EXT_BADGES = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  ppt: "PPT",
  pptx: "PPT",
};

function extOf(name) {
  return name?.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Opens a proof in-place instead of a raw new tab — a click here should
 * feel like part of the task, not a jump out of the app. Images preview
 * inline, PDFs render in an iframe, everything else (Word/Excel/PowerPoint)
 * falls back to a plain file badge since browsers can't preview those —
 * the Download button underneath is the one action guaranteed to work for
 * every file type.
 */
export default function ProofPreviewModal({ proof, onClose }) {
  if (!proof) return null;

  const isImage = proof.mime_type?.startsWith("image/");
  const ext = extOf(proof.file_name);
  const isPdf = ext === "pdf";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{proof.file_name}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Uploaded by {proof.uploaded_by_name ?? "intern"} · {proof.created_at}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-50 p-4">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proof.file_url} alt={proof.file_name} className="max-h-[55vh] w-auto rounded-xl object-contain shadow-sm" />
          ) : isPdf ? (
            <iframe src={proof.file_url} title={proof.file_name} className="h-[55vh] w-full rounded-xl border border-slate-200 bg-white" />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-sm font-bold text-slate-500">
                {EXT_BADGES[ext] ?? "FILE"}
              </span>
              <p className="text-sm text-slate-500">Preview isn&apos;t available for this file type — download it to open.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Close
          </button>
          <a
            href={proof.file_url}
            download={proof.file_name}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
