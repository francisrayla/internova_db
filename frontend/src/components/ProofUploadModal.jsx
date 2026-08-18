"use client";

import { useRef, useState } from "react";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_EXT = ["jpg", "jpeg", "png", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
const FILE_INPUT_ACCEPT =
  ".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FilePreview({ item, onRemove }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt={item.file.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-[10px] font-bold text-slate-500">
          {EXT_BADGES[extOf(item.file.name)] ?? "FILE"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-700">{item.file.name}</p>
        <p className="text-[11px] text-slate-400">{(item.file.size / 1024).toFixed(0)} KB</p>
      </div>
      <button type="button" onClick={onRemove} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50">
        Remove
      </button>
    </div>
  );
}

/**
 * Gates every task/subtask completion behind proof — dragging a card to
 * "Done" opens this instead of updating status right away. Confirming
 * uploads the files and only then flips the status; canceling leaves the
 * card exactly where it was, since nothing was ever sent to the backend.
 * "Take a photo" reuses the OS camera via <input capture> rather than a
 * custom getUserMedia flow — works the same on desktop (falls back to the
 * file picker) and mobile (opens the camera app directly).
 */
export default function ProofUploadModal({ title, onConfirm, onCancel }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  function addFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const rejected = files.find((f) => !ACCEPTED_EXT.includes(extOf(f.name)) || f.size > MAX_FILE_BYTES);
    if (rejected) {
      setError(`"${rejected.name}" isn't allowed — use a photo, PDF, or Word/Excel/PowerPoint file up to 15MB each.`);
      return;
    }

    setError("");
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }

  function removeItem(index) {
    setItems((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleConfirm() {
    if (items.length === 0) {
      setError("Attach at least one photo or file as proof before marking this done.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm(items.map((i) => i.file));
    } catch (err) {
      setError(err.message || "Could not upload proof.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Mark as done</h3>
        <p className="mt-1 text-sm text-slate-600">
          Attach a photo or file as proof that <span className="font-medium text-slate-800">&quot;{title}&quot;</span> is finished.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 rounded-xl border border-dashed border-blue-300 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            📷 Take a photo
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Upload files
          </button>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 && (
          <div className="mt-4 space-y-2">
            {items.map((item, i) => (
              <FilePreview key={i} item={item} onRemove={() => removeItem(i)} />
            ))}
          </div>
        )}

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || items.length === 0}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "Uploading…" : "Confirm & mark done"}
          </button>
        </div>
      </div>
    </div>
  );
}
