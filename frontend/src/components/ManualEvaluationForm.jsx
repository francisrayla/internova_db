"use client";

import { useState } from "react";
import { clampOnBlur } from "@/lib/clampNumber";

import { inputProps, cleanNumber } from "@/lib/inputRules";
/**
 * The Basic-plan counterpart to EvaluationForm — no criteria rubric to fill
 * line by line, just one overall score the supervisor enters directly plus
 * remarks. Exists because Formal Evaluations (the criteria-based version)
 * is a Premium-only feature; a Basic school still needs some way to grade
 * an intern.
 */
export default function ManualEvaluationForm({ interns, onSubmit, onCancel }) {
  const [deploymentId, setDeploymentId] = useState(interns[0]?.deployment_id ?? "");
  const [evaluationDate, setEvaluationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [overallScore, setOverallScore] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!deploymentId) {
      setError("Select an intern.");
      return;
    }
    if (overallScore === "" || Number(overallScore) < 0 || Number(overallScore) > 100) {
      setError("Enter a score from 0 to 100.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        deployment_id: deploymentId,
        evaluation_date: evaluationDate,
        overall_score: Number(overallScore),
        remarks: remarks.trim() || null,
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
          <span className="mb-1.5 block font-semibold text-slate-700">Date rated</span>
          <input type="date" value={evaluationDate} onChange={(e) => setEvaluationDate(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Overall score (0-100)</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={overallScore}
            onChange={(e) => setOverallScore(cleanNumber(e.target.value, { max: 100, decimals: 2 }))}
            onBlur={(e) => setOverallScore(clampOnBlur(e.target.value, 0, 100))}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-semibold text-slate-700">Remarks</span>
        <textarea {...inputProps("longText")} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4} placeholder="How did they do?" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
      </label>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
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
    </form>
  );
}
