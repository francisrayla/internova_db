"use client";

const CATEGORY_DESCRIPTIONS = {
  "B. Interpersonal Skills": "The measure of the trainee's ability to relate to one another and to operate within the division where they are assigned through social communication and interaction.",
};

function scoreColor(score, max) {
  if (max <= 0) return "text-slate-500";
  const pct = (score / max) * 100;
  if (pct >= 90) return "text-emerald-700";
  if (pct >= 75) return "text-blue-700";
  if (pct >= 60) return "text-amber-700";
  return "text-red-700";
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
          <p className="text-sm font-semibold text-slate-900">Internship evaluation</p>
          <p className="text-sm text-slate-500">
            {evaluation.evaluation_date}
            {evaluation.evaluator_name ? ` · Rated by ${evaluation.evaluator_name}` : ""}
            {evaluation.edited_at ? ` · Updated ${evaluation.edited_at}` : ""}
          </p>
        </div>
        {evaluation.overall_score != null && (
          <span className="k-pill is-info text-sm font-bold">{Number(evaluation.overall_score).toFixed(0)}/100</span>
        )}
      </div>

      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat} className="rounded-xl bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-800">{cat}</h4>
            {CATEGORY_DESCRIPTIONS[cat] && <p className="mt-0.5 text-sm text-slate-500">{CATEGORY_DESCRIPTIONS[cat]}</p>}
            <div className="mt-2 space-y-1.5">
              {byCategory[cat].map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 text-slate-700">{s.criterion_name}</span>
                  <span className={`shrink-0 font-semibold ${scoreColor(Number(s.score), Number(s.max_score))}`}>
                    {Number(s.score)}/{Number(s.max_score)}
                  </span>
                </div>
              ))}
            </div>
            {categoryComments[cat] && (
              <p className="mt-3 border-t border-slate-200 pt-2.5 text-sm text-slate-600">{categoryComments[cat]}</p>
            )}
          </div>
        ))}
      </div>

      {evaluation.remarks && (
        <div className="k-note">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold">Areas to focus on for development</h4>
            <p className="mt-1 text-sm">{evaluation.remarks}</p>
          </div>
        </div>
      )}
    </div>
  );
}
