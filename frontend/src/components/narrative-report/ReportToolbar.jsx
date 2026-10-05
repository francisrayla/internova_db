"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

/**
 * Top bar of the narrative report pages: back link, "Download Word (.docx)"
 * (fetched with the Bearer token, then saved via a temporary <a download>) and
 * "Print". Hidden when printing.
 */
export default function ReportToolbar({ backHref, backLabel, docxUrl }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function downloadDocx() {
    setBusy(true);
    setError("");
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
      setError("We couldn't prepare the Word file. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="text-sm font-semibold text-blue-600 hover:underline">{backLabel}</Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadDocx}
            disabled={busy}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Preparing…" : "Download Word (.docx)"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Print
          </button>
        </div>
      </div>
      {error && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <p className="mb-3 text-xs text-slate-500">
        Download gives an editable Word file (8.5 × 13 in). Print uses the browser: choose paper size Legal / 8.5 × 13 in and turn on &quot;Background graphics&quot;.
      </p>
    </div>
  );
}
