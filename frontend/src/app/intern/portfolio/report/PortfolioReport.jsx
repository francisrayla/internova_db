"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchInternData } from "@/lib/internApi";
import NarrativeReport from "@/components/narrative-report/NarrativeReport";
import ReportToolbar from "@/components/narrative-report/ReportToolbar";

export default function PortfolioReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchInternData("portfolio/narrative-report")
      .then(setData)
      .catch(() => setError("We couldn't prepare your report. Make sure you have a deployment, then try again."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Preparing report…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/intern/portfolio" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Portfolio</Link>
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Report not found."}</p>
      </div>
    );
  }

  return (
    <div>
      <ReportToolbar backHref="/intern/portfolio" backLabel="← Back to Portfolio" docxUrl="/api/intern/portfolio/narrative-report/docx" />
      <NarrativeReport data={data} />
    </div>
  );
}
