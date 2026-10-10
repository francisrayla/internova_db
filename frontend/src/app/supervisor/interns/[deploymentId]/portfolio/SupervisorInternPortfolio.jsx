"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import InternPortfolioView from "@/components/InternPortfolioView";
import { ErrorNote, SkeletonList } from "@/components/ui";
import { Page, PageHeader } from "@/components/dash/page";

export default function SupervisorInternPortfolio() {
  const { deploymentId } = useParams();
  const [internName, setInternName] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSupervisorData(`interns/${deploymentId}/portfolio`)
      .then((r) => {
        setInternName(r.intern_name);
        setPortfolio(r.portfolio);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  return (
    <Page>
      <PageHeader back={{ href: "/supervisor/interns", label: "Back to Interns" }} title={internName ? `${internName}'s Portfolio` : "Portfolio"} />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={2} height="h-32" />
      ) : (
        <InternPortfolioView internName={internName} portfolio={portfolio} />
      )}
    </Page>
  );
}
