"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import EvaluationView from "@/components/EvaluationView";

const AUTO_GRADED_CATEGORY = "A. Technical Ability";

function NewCriterionForm({ onSaved }) {
  const [form, setForm] = useState({ name: "", description: "", category: "", max_score: 5, weight: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter a criterion name.");
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/evaluation-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, category: form.category.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not add criterion.");
      setForm({ name: "", description: "", category: "", max_score: 5, weight: 1 });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Section (optional)</span>
        <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. E. Extra" className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Criterion name</span>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Work Attitude" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Max score</span>
        <input type="number" min="1" max="100" value={form.max_score} onChange={(e) => setForm((f) => ({ ...f, max_score: e.target.value }))} className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Weight</span>
        <input type="number" min="0.1" max="20" step="0.1" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <button type="submit" disabled={saving} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{saving ? "Adding…" : "Add criterion"}</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function CriterionPill({ criterion }) {
  const autoGraded = criterion.category === AUTO_GRADED_CATEGORY;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${autoGraded ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"}`}>
      {criterion.name} · max {Number(criterion.max_score)}
      {autoGraded && <span title="Score comes from this intern's average task rating">· auto</span>}
    </span>
  );
}

/**
 * Coordinator owns the rubric (add/adjust criteria below) but is view-only
 * for the actual evaluations — the supervisor is the one who sits with the
 * intern and fills the form in (see the supervisor's own Evaluations
 * screen).
 */
export default function EvaluationMonitoring() {
  const [evaluations, setEvaluations] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    Promise.all([fetchCoordinatorData("evaluations"), fetchCoordinatorData("evaluation-criteria")])
      .then(([evalRes, critRes]) => {
        setEvaluations(evalRes.evaluations ?? []);
        setCriteria(critRes.criteria ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const criteriaByCategory = useMemo(() => {
    return criteria.reduce((acc, c) => {
      (acc[c.category ?? "Other"] ??= []).push(c);
      return acc;
    }, {});
  }, [criteria]);

  const visibleEvaluations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return evaluations;
    return evaluations.filter((e) => e.intern_name?.toLowerCase().includes(q));
  }, [evaluations, search]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Evaluations</h2>
        <p className="mt-1 text-sm text-slate-600">Manage the school scoring rubric — supervisors submit the actual evaluations.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluation criteria ({criteria.length})</p>
        {criteria.length > 0 && (
          <div className="mb-3 space-y-2">
            {Object.entries(criteriaByCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="mb-1 text-xs font-semibold text-slate-600">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map((c) => (
                    <CriterionPill key={c.id} criterion={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <NewCriterionForm onSaved={load} />
      </section>

      {evaluations.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by intern name…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </section>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading evaluations…</p>
      ) : evaluations.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No evaluations submitted yet.</p>
      ) : visibleEvaluations.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No evaluations match your search.</p>
      ) : (
        <div className="space-y-3">
          {visibleEvaluations.map((e) => (
            <div key={e.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-slate-900">{e.intern_name}</p>
              <EvaluationView evaluation={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
