"use client";

import { useState } from "react";
import Link from "next/link";
import DownloadDocxButton from "./DownloadDocxButton";

/**
 * Top bar of the narrative report pages: back link, "Download Word (.docx)"
 * and "Print". Hidden when printing.
 */
export default function ReportToolbar({ backHref, backLabel, docxUrl }) {
  const [error, setError] = useState("");

  return (
    <div className="print:hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="text-sm font-semibold text-blue-600 hover:underline">{backLabel}</Link>
        <div className="flex items-center gap-2">
          <DownloadDocxButton docxUrl={docxUrl} onError={setError} />
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
