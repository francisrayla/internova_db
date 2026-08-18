"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

const CATEGORY_DESCRIPTIONS = {
  "B. Interpersonal Skills": "The measure of the trainee's ability to relate to one another and to operate within the division where they are assigned through social communication and interaction.",
};

const EVALUATION_TYPES = ["Midterm", "Final", "Monthly"];

/**
 * Transcribes the school's printed OJT evaluation form into a fillable
 * screen — one number field per line item (capped at that item's printed
 * max), one shared comment box per section, and the same closing "areas
 * for development" feedback field the paper form ends with. Any criterion
 * the coordinator flagged as "auto-fill from task ratings" comes
 * pre-filled from that intern's accumulated per-task ratings — still
 * editable, just not a blank field the supervisor has to re-score by hand.
 */
export default function EvaluationForm({ interns, criteria: initialCriteria, onSubmit, onCancel }) {
  const [deploymentId, setDeploymentId] = useState(interns[0]?.deployment_id ?? "");
  const [criteria, setCriteria] = useState(initialCriteria);
  const [evaluationType, setEvaluationType] = useState("Midterm");
  const [evaluationDate, setEvaluationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scores, setScores] = useState({});
  const [autoFilled, setAutoFilled] = useState({});
  const [categoryComments, setCategoryComments] = useState({});
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deploymentId) return;
    let cancelled = false;

    apiFetch(`/api/supervisor/evaluation-criteria?deployment_id=${deploymentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = data.criteria ?? [];
        setCriteria(list);

        const nextScores = {};
        const nextAuto = {};
        for (const c of list) {
          if (c.suggested_score != null) {
            nextScores[c.id] = c.suggested_score;
            nextAuto[c.id] = c.task_rating_average;
          }
        }
        setScores(nextScores);
        setAutoFilled(nextAuto);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [deploymentId]);

  const byCategory = useMemo(() => {
    return criteria.reduce((acc, c) => {
      (acc[c.category ?? "Other"] ??= []).push(c);
      return acc;
    }, {});
  }, [criteria]);
  const categories = Object.keys(byCategory);

  const maxTotal = criteria.reduce((sum, c) => sum + Number(c.max_score), 0);
  const currentTotal = criteria.reduce((sum, c) => sum + (Number(scores[c.id]) || 0), 0);

  function setScore(criterionId, value, max) {
    const clamped = Math.max(0, Math.min(Number(max), Number(value) || 0));
    setScores((prev) => ({ ...prev, [criterionId]: clamped }));
    setAutoFilled((prev) => ({ ...prev, [criterionId]: undefined }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!deploymentId) {
      setError("Select an intern.");
      return;
    }
    const missing = criteria.some((c) => scores[c.id] === undefined || scores[c.id] === "");
    if (missing) {
      setError("Score every line item before submitting.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        deployment_id: deploymentId,
        evaluation_type: evaluationType,
        evaluation_date: evaluationDate,
        remarks: remarks.trim() || null,
        category_comments: categoryComments,
        scores: criteria.map((c) => ({ criteria_id: c.id, score: scores[c.id] ?? 0 })),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Intern</span>
          <select value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Evaluation type</span>
          <select value={evaluationType} onChange={(e) => setEvaluationType(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            {EVALUATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Date rated</span>
          <input type="date" value={evaluationDate} onChange={(e) => setEvaluationDate(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </label>
      </div>

      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat} className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-800">{cat}</h4>
            {CATEGORY_DESCRIPTIONS[cat] && <p className="mt-0.5 text-xs text-slate-400">{CATEGORY_DESCRIPTIONS[cat]}</p>}
            <div className="mt-3 space-y-2">
              {byCategory[cat].map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-400">{c.description}</p>}
                    {autoFilled[c.id] != null && (
                      <p className="text-[11px] font-medium text-purple-600">Auto-filled from task ratings (avg {autoFilled[c.id]}/10)</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-sm">
                    <input
                      type="number"
                      min="0"
                      max={c.max_score}
                      value={scores[c.id] ?? ""}
                      onChange={(e) => setScore(c.id, e.target.value, c.max_score)}
                      className={`w-16 rounded-lg border px-2 py-1.5 text-center outline-none focus:border-blue-500 ${autoFilled[c.id] != null ? "border-purple-300 bg-purple-50" : "border-slate-300"}`}
                    />
                    <span className="text-slate-400">/ {Number(c.max_score)}</span>
                  </div>
                </div>
              ))}
            </div>
            <textarea
              value={categoryComments[cat] ?? ""}
              onChange={(e) => setCategoryComments((prev) => ({ ...prev, [cat]: e.target.value }))}
              placeholder="Comments (optional)"
              rows={2}
              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-semibold text-slate-700">In what areas do you recommend this student focus for development?</span>
        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
      </label>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-500">
          Total: <span className="font-semibold text-slate-800">{currentTotal}</span> / {maxTotal}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          )}
          {error && <p className="self-center text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Submitting…" : "Submit evaluation"}
          </button>
        </div>
      </div>
    </form>
  );
}
