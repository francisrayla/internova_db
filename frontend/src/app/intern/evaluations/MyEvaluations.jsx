"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import EvaluationView from "@/components/EvaluationView";
import { EmptyState, ErrorNote, Page, PageHeader, Section, SkeletonList } from "@/components/dash/page";

const LIVE_TYPES = ["evaluation_submitted", "evaluation_updated"];

/**
 * Read-only — the supervisor fills these in (see the supervisor's own
 * Evaluations screen); this is just the intern's own feedback and score
 * once it's been submitted.
 */
export default function MyEvaluations() {
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetchInternData("evaluations")
      .then((r) => setEvaluations(r.evaluations ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);

  return (
    <Page size="narrow">
      <PageHeader title="My evaluations" sentence="Feedback and performance history from your supervisor." />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={2} height="h-40" />
      ) : evaluations.length === 0 ? (
        <EmptyState icon="evaluations" title="No evaluations yet" text="Your supervisor has not submitted one. It will show up here once they do." />
      ) : (
        evaluations.map((e) => (
          <Section key={e.id}>
            <EvaluationView evaluation={e} />
          </Section>
        ))
      )}
    </Page>
  );
}
