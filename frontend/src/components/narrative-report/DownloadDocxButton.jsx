"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

/**
 * "Download Word (.docx)": fetched with the Bearer token, then saved via a
 * temporary <a download>. Shared by ReportToolbar and the Dean's intern page.
 */
export default function DownloadDocxButton({ docxUrl, className, label = "Download Word (.docx)", onError }) {
  const [busy, setBusy] = useState(false);

  async function downloadDocx() {
    setBusy(true);
    onError?.("");
    try {
      const response = await apiFetch(docxUrl, {
        headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      });
      if (!response.ok) throw new Error("failed");
      const disposition = response.headers.get("content-disposition") || "";
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : "Narrative_Report.docx";
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch {
      onError?.("We couldn't prepare the Word file. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={downloadDocx}
      disabled={busy}
      className={className ?? "rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"}
    >
      {busy ? "Preparing…" : label}
    </button>
  );
}
