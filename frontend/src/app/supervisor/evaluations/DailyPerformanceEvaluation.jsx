"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";
import { inputProps } from "@/lib/inputRules";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SectionTitle, SkeletonList } from "@/components/ui";
import { scoreTone } from "./evalHelpers";

const NEW_HREF = "/supervisor/evaluations/new";

function groupByCategory(scores = []) {
  return scores.reduce((acc, s) => {
    (acc[s.category ?? "Other"] ??= []).push(s);
    return acc;
  }, {});
}

function Breakdown({ evaluation }) {
  const groups = groupByCategory(evaluation.scores);
  const comments = evaluation.category_comments ?? {};
  const cats = Object.keys(groups);

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {cats.length === 0 && <p className="text-sm text-slate-500">This was a manual evaluation, so there is no per-criterion breakdown.</p>}
      {cats.map((cat) => {
        const got = groups[cat].reduce((n, s) => n + Number(s.score), 0);
        const max = groups[cat].reduce((n, s) => n + Number(s.max_score), 0);
        return (
          <div key={cat} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="min-w-0 text-sm font-semibold text-slate-800">{cat}</h4>
              <span className="shrink-0 text-sm font-semibold text-slate-700">{got} / {max}</span>
            </div>
            <div className="mt-2 space-y-1">
              {groups[cat].map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 text-slate-600">{s.criterion_name}</span>
                  <span className="shrink-0 font-medium text-slate-800">{Number(s.score)} / {Number(s.max_score)}</span>
                </div>
              ))}
            </div>
            {comments[cat] && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{comments[cat]}</p>}
          </div>
        );
      })}
      {evaluation.remarks && (
        <div className="rounded-xl bg-blue-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-blue-900">{cats.length ? "Areas to focus on for development" : "Remarks"}</p>
          <p className="mt-0.5 text-sm text-blue-800">{evaluation.remarks}</p>
        </div>
      )}
    </div>
  );
}

function EvaluationCard({ evaluation: e, highlighted, several }) {
  const [open, setOpen] = useState(false);
  const score = e.overall_score != null ? Number(e.overall_score) : null;

  return (
    <div id={`evaluation-${e.id}`} className={`rounded-2xl border bg-white p-4 shadow-sm ${highlighted ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"}`}>
      <div className="flex items-center gap-3">
        <Avatar name={e.intern_name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{e.intern_name}</p>
          <p className="truncate text-xs text-slate-500">
            {e.evaluation_date}
            {e.evaluator_name ? ` · Rated by ${e.evaluator_name}` : ""}
            {e.edited_at ? ` · Edited ${e.edited_at}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {several && <Pill tone={e.is_official ? "blue" : "amber"}>{e.is_official ? "Counts" : "Earlier"}</Pill>}
          {e.evaluation_type !== "Final" && <Pill tone="slate">{e.evaluation_type}</Pill>}
          {score != null && <Pill tone={scoreTone(score)}>{score.toFixed(0)}/100</Pill>}
        </div>
      </div>
      {several && !e.is_official && (
        <p className="mt-2 text-xs text-amber-700">This intern has more than one evaluation. Only the latest one counts for the score and the report. This one is kept for reference.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {(e.scores?.length > 0 || e.remarks) && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-sm font-semibold text-blue-600 hover:underline">
            {open ? "Hide breakdown" : "View breakdown"}
          </button>
        )}
        <Link href={`${NEW_HREF}?edit=${e.id}`} className="text-sm font-semibold text-blue-600 hover:underline">Edit</Link>
      </div>
      {open && <Breakdown evaluation={e} />}
    </div>
  );
}

/**
 * List of past evaluations only. Filling one in happens on its own screen
 * (/supervisor/evaluations/new) so this page stays short.
 */
export default function DailyPerformanceEvaluation() {
  const { user } = useCurrentUser();
  const formalEnabled = hasPlanFeature(user, PLAN_FEATURES.FORMAL_EVALUATIONS);
  const params = useSearchParams();
  const savedId = Number(params.get("saved")) || null;
  const wasEdited = params.get("edited") === "1";

  const [interns, setInterns] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [criteriaCount, setCriteriaCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(Boolean(savedId));
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");

  function load() {
    Promise.all([
      formalEnabled ? fetchSupervisorData("evaluation-criteria") : Promise.resolve({ criteria: [] }),
      fetchSupervisorData("evaluations"),
    ])
      .then(([criteriaRes, evalRes]) => {
        setCriteriaCount((criteriaRes.criteria ?? []).length);
        setEvaluations(evalRes.evaluations ?? []);
        setInterns(evalRes.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [formalEnabled]);

  function retry() {
    setLoading(true);
    setError("");
    load();
  }

  useEffect(() => {
    if (!savedId || loading) return;
    document.getElementById(`evaluation-${savedId}`)?.scrollIntoView({ block: "center" });
  }, [savedId, loading]);

  const types = useMemo(() => {
    // Evaluations are one per intern now, so the type filter only appears when older data holds different types.
    const present = [...new Set(evaluations.map((e) => e.evaluation_type))];
    return present.length > 1 ? ["All", ...present] : [];
  }, [evaluations]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return evaluations.filter((e) => (type === "All" || e.evaluation_type === type) && (!q || e.intern_name?.toLowerCase().includes(q)));
  }, [evaluations, search, type]);

  const setupMissing = formalEnabled && criteriaCount === 0;
  const ready = interns.filter((i) => i.can_evaluate);
  const canCreate = ready.length > 0 && !setupMissing;
  const perIntern = useMemo(() => evaluations.reduce((m, e) => m.set(e.deployment_id, (m.get(e.deployment_id) ?? 0) + 1), new Map()), [evaluations]);
  const newButton = canCreate ? (
    <Link href={NEW_HREF} className="inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
      New evaluation
    </Link>
  ) : (
    <span className="inline-flex cursor-not-allowed rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white opacity-40" aria-disabled="true">
      New evaluation
    </span>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Evaluations</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formalEnabled ? "Rate interns at your company using your school's evaluation form." : "Give interns at your company an overall score and remarks."}
          </p>
        </div>
        {!loading && newButton}
      </div>
      {!loading && !canCreate && !setupMissing && interns.length > 0 && (
        <p className="text-sm text-slate-600">
          No intern can be evaluated yet. An intern is evaluated once, after completing the required hours.
          {interns.some((i) => i.block_code === "not_finished") ? " Still rendering hours: " + interns.filter((i) => i.block_code === "not_finished").map((i) => `${i.name} (${Number(i.approved_hours)} of ${i.required_hours} hrs)`).join(", ") + "." : ""}
        </p>
      )}

      {savedId && banner && (
        <Banner tone="green" onDismiss={() => setBanner(false)}>
          {wasEdited ? "Evaluation updated. It is highlighted below." : "Evaluation submitted. It is highlighted below."}
        </Banner>
      )}
      {error && <ErrorNote onRetry={retry}>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={3} />
      ) : setupMissing ? (
        <EmptyState icon="check" title="Evaluation criteria not set up" text="Your coordinator has not set up the evaluation criteria yet." />
      ) : interns.length === 0 ? (
        <EmptyState icon="check" title="No interns yet" text="No interns are deployed at your company yet." />
      ) : (
        <section>
          <SectionTitle title="Past evaluations" help={`${evaluations.length} submitted`} />
          {evaluations.length > 0 && (
            <div className="mb-3 space-y-2">
              <input
                {...inputProps("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search intern…"
                aria-label="Search intern"
                className="w-full max-w-sm rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <div className={`flex flex-wrap gap-2 ${types.length ? "" : "hidden"}`}>
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    className={`rounded-full border px-3 py-1 text-sm font-medium ${type === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {evaluations.length === 0 ? (
            <EmptyState icon="check" title="No evaluations yet" text="Evaluations you submit will show up here." action={newButton} />
          ) : visible.length === 0 ? (
            <EmptyState icon="check" title="No matches" text="No evaluations match your search or filter." />
          ) : (
            <div className="space-y-3">
              {visible.map((e) => (
                <EvaluationCard key={e.id} evaluation={e} highlighted={e.id === savedId} several={(perIntern.get(e.deployment_id) ?? 0) > 1} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
