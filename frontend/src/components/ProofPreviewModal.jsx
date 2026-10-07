"use client";

import { FileViewer } from "@/components/FileViewer";

/** A task proof opened in place. Same viewer as every other file, so it always has a close button. */
export default function ProofPreviewModal({ proof, onClose }) {
  if (!proof) return null;
  return (
    <FileViewer
      file={{
        url: proof.file_url,
        name: proof.file_name,
        type: proof.mime_type,
        subtitle: `Uploaded by ${proof.uploaded_by_name ?? "intern"} · ${proof.created_at}`,
      }}
      onClose={onClose}
    />
  );
}
