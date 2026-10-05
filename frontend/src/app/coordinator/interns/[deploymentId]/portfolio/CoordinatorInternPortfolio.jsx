"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import InternPortfolioView from "@/components/InternPortfolioView";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";

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
    <div className="space-y-6">
      <div>
        <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">
          ← Back to Interns
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{internName ? `${internName}'s Portfolio` : "Portfolio"}</h2>
          <Link href={`/coordinator/interns/${deploymentId}/narrative-report`} className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Open narrative report
          </Link>
        </div>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {narrative && <NarrativeChecklist report={narrative} />}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Loading portfolio…</p>
      ) : (
        <InternPortfolioView internName={internName} portfolio={portfolio} />
      )}
    </div>
  );
}
