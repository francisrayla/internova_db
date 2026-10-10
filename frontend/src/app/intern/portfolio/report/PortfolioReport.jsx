"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import NarrativeReport from "@/components/narrative-report/NarrativeReport";
import ReportToolbar from "@/components/narrative-report/ReportToolbar";
import { ErrorNote, Page, PageHeader, SkeletonList } from "@/components/dash/page";

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
    return (
      <Page size="narrow">
        <SkeletonList rows={2} height="h-40" />
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page size="narrow">
        <PageHeader back={{ href: "/intern/portfolio", label: "Back to Portfolio" }} title="Portfolio report" />
        <ErrorNote>{error || "Report not found."}</ErrorNote>
      </Page>
    );
  }

  return (
    <div>
      <ReportToolbar backHref="/intern/portfolio" backLabel="Back to Portfolio" docxUrl="/api/intern/portfolio/narrative-report/docx" />
      <NarrativeReport data={data} />
    </div>
  );
}
