"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import NarrativeReport from "@/components/narrative-report/NarrativeReport";
import ReportToolbar from "@/components/narrative-report/ReportToolbar";
import { ErrorNote, SkeletonList } from "@/components/ui";
import { Page, PageHeader } from "@/components/dash/page";

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
    return <Page><SkeletonList rows={2} height="h-24" /></Page>;
  }

  if (error || !data) {
    return (
      <Page>
        <PageHeader title="Narrative report" back={{ href: "/coordinator/interns", label: "Back to Interns" }} />
        <ErrorNote>{error || "Report not found."}</ErrorNote>
      </Page>
    );
  }

  return (
    <div>
      <ReportToolbar backHref={`/coordinator/interns/${deploymentId}/portfolio`} backLabel="Back to Portfolio" docxUrl={`/api/coordinator/interns/${deploymentId}/narrative-report/docx`} />
      <NarrativeReport data={data} />
    </div>
  );
}
