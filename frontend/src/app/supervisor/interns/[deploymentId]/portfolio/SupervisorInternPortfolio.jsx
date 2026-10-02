"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import InternPortfolioView from "@/components/InternPortfolioView";

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
    <div className="space-y-6">
      <div>
        <Link href="/supervisor/interns" className="text-sm font-semibold text-blue-600 hover:underline">
          ← Back to Assigned Interns
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
