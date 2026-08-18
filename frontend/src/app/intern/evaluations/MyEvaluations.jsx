"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import EvaluationView from "@/components/EvaluationView";

const LIVE_TYPES = ["evaluation_submitted"];

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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">My Evaluations</h2>
        <p className="mt-1 text-sm text-slate-600">View feedback and performance history from your supervisor.</p>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading…</p>
      ) : evaluations.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No evaluations yet — your supervisor has not submitted one.</p>
      ) : (
        <div className="space-y-3">
          {evaluations.map((e) => (
            <div key={e.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <EvaluationView evaluation={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
