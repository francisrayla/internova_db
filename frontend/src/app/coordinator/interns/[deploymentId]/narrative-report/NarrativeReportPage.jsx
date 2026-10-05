"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import NarrativeReport from "@/components/narrative-report/NarrativeReport";
import ReportToolbar from "@/components/narrative-report/ReportToolbar";

export default function CoordinatorNarrativeReport() {
  const { deploymentId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchCoordinatorData(`interns/${deploymentId}/narrative-report`)
      .then(setData)
      .catch(() => setError("Report not found."))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Preparing report…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Interns</Link>
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Report not found."}</p>
      </div>
    );
  }

  return (
    <div>
      <ReportToolbar backHref={`/coordinator/interns/${deploymentId}/portfolio`} backLabel="← Back to Portfolio" docxUrl={`/api/coordinator/interns/${deploymentId}/narrative-report/docx`} />
      <NarrativeReport data={data} />
    </div>
  );
}
