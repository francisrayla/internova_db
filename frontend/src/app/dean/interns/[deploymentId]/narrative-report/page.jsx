"use client";

import { useEffect, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { Btn, Page } from "@/components/dash/page";
import { useParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import NarrativeReport from "@/components/narrative-report/NarrativeReport";
import ReportToolbar from "@/components/narrative-report/ReportToolbar";

export default function DeanNarrativeReport() {
  const { deploymentId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchApiData("dean", `interns/${deploymentId}/narrative-report`)
      .then(setData)
      .catch(() => setError("Report not found."))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500" role="status">Preparing report…</p>;
  }

  if (error || !data) {
    return (
      <Page size="narrow">
        <div>
          <Btn href="/dean/interns" variant="ghost" sm><NavIcon name="back" size={16} /> Back to Interns</Btn>
        </div>
        <p className="k-note is-risk" role="alert">{error || "Report not found."}</p>
      </Page>
    );
  }

  return (
    <div>
      <ReportToolbar backHref={`/dean/interns/${deploymentId}?tab=narrative`} backLabel="Back to intern" docxUrl={`/api/dean/interns/${deploymentId}/narrative-report/docx`} />
      <NarrativeReport data={data} />
    </div>
  );
}
