"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import InternPortfolioView from "@/components/InternPortfolioView";

export default function CoordinatorInternPortfolio() {
  const { deploymentId } = useParams();
  const [internName, setInternName] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
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
  }, [deploymentId]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">
          ← Back to Interns
        </Link>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">{internName ? `${internName}'s Portfolio` : "Portfolio"}</h2>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Loading portfolio…</p>
      ) : (
        <InternPortfolioView internName={internName} portfolio={portfolio} />
      )}
    </div>
  );
}
