"use client";

import { useRef, useState } from "react";
import { Btn, FormField, Input, SheetFrame } from "@/components/dash/page";
import { apiFetch } from "@/lib/apiFetch";
import { shrinkImage } from "@/lib/imageCompress";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// Uploads one report requirement (e.g. "Endorsement letter") straight from the
// "What your report needs" checklist. Same endpoint and fields as the Documents
// page (POST /api/intern/documents with document_type + file), so the coordinator
// reviews it the same way.
export default function UploadRequirementSheet({ documentType, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const upload = await shrinkImage(file);
      if (upload.size > MAX_DOCUMENT_BYTES) {
        throw new Error(`"${upload.name}" is bigger than 10MB. Choose a smaller file.`);
      }
      const formData = new FormData();
      formData.append("document_type", documentType);
      formData.append("file", upload);
      const res = await apiFetch("/api/intern/documents", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not upload this document.");
      onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      onClose={onClose}
      title={`Upload ${documentType}`}
      description="Your coordinator checks it and marks it approved. You can see its status in Documents."
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="File" hint="JPG, PNG, PDF, DOC or DOCX, up to 10MB. Photos are resized automatically.">
          <Input type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
  );
}
