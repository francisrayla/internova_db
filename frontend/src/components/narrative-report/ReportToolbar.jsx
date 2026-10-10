"use client";

import { useState } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { btnClass } from "@/components/dash/page";
import DownloadDocxButton from "./DownloadDocxButton";

/**
 * Top bar of the narrative report pages: back link, "Download Word (.docx)"
 * and "Print". Hidden when printing.
 */
export default function ReportToolbar({ backHref, backLabel, docxUrl }) {
  const [error, setError] = useState("");

  return (
    <div className="print:hidden">
      <h1 className="sr-only">Narrative report</h1>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="k-back"><NavIcon name="back" size={16} />{String(backLabel).replace(/^←\s*/, "")}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadDocxButton docxUrl={docxUrl} onError={setError} className={btnClass("primary")} />
          <button
            type="button"
            onClick={() => window.print()}
            className={btnClass("secondary")}
          >
            Print
          </button>
        </div>
      </div>
      {error && <p className="k-note is-risk mb-3">{error}</p>}
      <p className="mb-3 text-sm text-slate-500">
        Download gives an editable Word file (8.5 × 13 in). Print uses the browser: choose paper size Legal / 8.5 × 13 in and turn on &quot;Background graphics&quot;.
      </p>
    </div>
  );
}
