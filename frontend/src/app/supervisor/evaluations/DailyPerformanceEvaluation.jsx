"use client";

import { useEffect, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";
import EvaluationForm from "@/components/EvaluationForm";
import EvaluationView from "@/components/EvaluationView";

/**
 * The school's own rubric, filled in by the supervisor for the interns
 * they actually supervise — the coordinator defines the criteria, but only
 * the supervisor submits an evaluation against them.
 */
export default function DailyPerformanceEvaluation() {
  const [criteria, setCriteria] = useState([]);
  const [interns, setInterns] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([fetchSupervisorData("evaluation-criteria"), fetchSupervisorData("evaluations")])
      .then(([criteriaRes, evalRes]) => {
        setCriteria(criteriaRes.criteria ?? []);
        setEvaluations(evalRes.evaluations ?? []);
        setInterns(evalRes.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(payload) {
    const res = await apiFetch("/api/supervisor/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Could not submit evaluation.");
    setShowForm(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Performance Evaluation</h2>
          <p className="mt-1 text-sm text-slate-600">Submit the school evaluation form for interns you supervise.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={interns.length === 0 || criteria.length === 0}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            New evaluation
          </button>
        )}
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading…</p>
      ) : criteria.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">
          Your coordinator has not set up the evaluation criteria yet.
        </p>
      ) : interns.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No interns assigned to you yet.</p>
      ) : (
        <>
          {showForm && (
            <EvaluationForm interns={interns} criteria={criteria} onSubmit={handleSubmit} onCancel={() => setShowForm(false)} />
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Past evaluations</h3>
            {evaluations.length === 0 ? (
              <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No evaluations submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {evaluations.map((e) => (
                  <div key={e.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="mb-3 text-sm font-semibold text-slate-900">{e.intern_name}</p>
                    <EvaluationView evaluation={e} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
