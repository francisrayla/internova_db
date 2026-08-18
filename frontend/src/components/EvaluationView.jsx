"use client";

const CATEGORY_DESCRIPTIONS = {
  "B. Interpersonal Skills": "The measure of the trainee's ability to relate to one another and to operate within the division where they are assigned through social communication and interaction.",
};

function scoreColor(score, max) {
  if (max <= 0) return "text-slate-500";
  const pct = (score / max) * 100;
  if (pct >= 90) return "text-emerald-600";
  if (pct >= 75) return "text-blue-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-600";
}

/**
 * Read-only rendering of one submitted evaluation, grouped by section the
 * same way the school's printed form is laid out — used by the
 * supervisor's own history, the coordinator's oversight view, and the
 * intern's own feedback screen alike.
 */
export default function EvaluationView({ evaluation }) {
  const byCategory = evaluation.scores.reduce((acc, s) => {
    (acc[s.category ?? "Other"] ??= []).push(s);
    return acc;
  }, {});
  const categories = Object.keys(byCategory);
  const categoryComments = evaluation.category_comments ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{evaluation.evaluation_type}</p>
          <p className="text-xs text-slate-500">
            {evaluation.evaluation_date}
            {evaluation.evaluator_name ? ` · Rated by ${evaluation.evaluator_name}` : ""}
          </p>
        </div>
        {evaluation.overall_score != null && (
          <span className="rounded-full bg-slate-900 px-3 py-1 text-sm font-bold text-white">{Number(evaluation.overall_score).toFixed(0)}/100</span>
        )}
      </div>

      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-800">{cat}</h4>
            {CATEGORY_DESCRIPTIONS[cat] && <p className="mt-0.5 text-xs text-slate-400">{CATEGORY_DESCRIPTIONS[cat]}</p>}
            <div className="mt-2 space-y-1.5">
              {byCategory[cat].map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">{s.criterion_name}</span>
                  <span className={`font-semibold ${scoreColor(Number(s.score), Number(s.max_score))}`}>
                    {Number(s.score)}/{Number(s.max_score)}
                  </span>
                </div>
              ))}
            </div>
            {categoryComments[cat] && (
              <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{categoryComments[cat]}</p>
            )}
          </div>
        ))}
      </div>

      {evaluation.remarks && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
          <h4 className="text-xs font-semibold text-blue-900">Areas to focus on for development</h4>
          <p className="mt-1 text-sm text-blue-800">{evaluation.remarks}</p>
        </div>
      )}
    </div>
  );
}
