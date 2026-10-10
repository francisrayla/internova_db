"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import InternPortfolioView from "@/components/InternPortfolioView";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";
import { ErrorNote, SkeletonList } from "@/components/ui";
import { Btn, Page, PageHeader } from "@/components/dash/page";

export default function CoordinatorInternPortfolio() {
  const { deploymentId } = useParams();
  const [internName, setInternName] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchCoordinatorData(`interns/${deploymentId}/portfolio`)
      .then((r) => {
        setInternName(r.intern_name);
        setPortfolio(r.portfolio);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    fetchCoordinatorData(`interns/${deploymentId}/narrative-report`)
      .then(setNarrative)
      .catch(() => setNarrative(null));
  }, [deploymentId]);

  return (
    <Page>
      <PageHeader
        back={{ href: "/coordinator/interns", label: "Back to Interns" }}
        title={internName ? `${internName}'s Portfolio` : "Portfolio"}
      >
        <Btn variant="primary" href={`/coordinator/interns/${deploymentId}/narrative-report`}>Open narrative report</Btn>
      </PageHeader>

      {error && <ErrorNote>{error}</ErrorNote>}

      {narrative && <NarrativeChecklist report={narrative} />}

      {loading ? (
        <section className="dash-card"><SkeletonList rows={3} height="h-16" /></section>
      ) : (
        <InternPortfolioView internName={internName} portfolio={portfolio} />
      )}
    </Page>
  );
}
