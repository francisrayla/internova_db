"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";
import { inputProps } from "@/lib/inputRules";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, Page, PageHeader, SearchField, Section, btnClass } from "@/components/dash/page";
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
    <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
      {cats.length === 0 && <p className="text-sm text-slate-500">This was a manual evaluation, so there is no per-criterion breakdown.</p>}
      {cats.map((cat) => {
        const got = groups[cat].reduce((n, s) => n + Number(s.score), 0);
        const max = groups[cat].reduce((n, s) => n + Number(s.max_score), 0);
        return (
          <div key={cat}>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="min-w-0 break-words text-sm font-semibold text-slate-900">{cat}</h4>
              <span className="shrink-0 text-sm font-semibold text-slate-700">{got} / {max}</span>
            </div>
            <ul className="mt-1 divide-y divide-slate-100">
              {groups[cat].map((s, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 break-words text-slate-600">{s.criterion_name}</span>
                  <span className="shrink-0 font-medium text-slate-800">{Number(s.score)} / {Number(s.max_score)}</span>
                </li>
              ))}
            </ul>
            {comments[cat] && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{comments[cat]}</p>}
          </div>
        );
      })}
      {evaluation.remarks && (
        <div className="k-note flex-col gap-0.5">
          <p className="text-xs font-semibold">{cats.length ? "Areas to focus on for development" : "Remarks"}</p>
          <p className="text-sm">{evaluation.remarks}</p>
        </div>
      )}
    </div>
  );
}

function EvaluationCard({ evaluation: e, highlighted, several }) {
  const [open, setOpen] = useState(false);
  const score = e.overall_score != null ? Number(e.overall_score) : null;

  return (
    <li id={`evaluation-${e.id}`} className={`k-item border-l-4 ${highlighted ? "border-l-emerald-500 bg-[var(--ui-ok-bg)]" : "border-l-transparent"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar name={e.intern_name} size={36} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="break-words text-sm font-semibold text-slate-900">{e.intern_name}</p>
          <p className="text-xs text-slate-500">
            {e.evaluation_date}
            {e.evaluator_name ? ` · Rated by ${e.evaluator_name}` : ""}
            {e.edited_at ? ` · Edited ${e.edited_at}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 max-sm:w-full max-sm:pl-12">
          {several && <Pill tone={e.is_official ? "blue" : "amber"}>{e.is_official ? "Counts" : "Earlier"}</Pill>}
          {score != null && <Pill tone={scoreTone(score)}>{score.toFixed(0)}/100</Pill>}
        </div>
      </div>
      {several && !e.is_official && (
        <p className="mt-2 text-xs text-amber-700">This intern has more than one evaluation. Only the latest one counts for the score and the report. This one is kept for reference.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-10">
        {(e.scores?.length > 0 || e.remarks) && (
          <Btn sm variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="!px-2 text-blue-600">
            {open ? "Hide breakdown" : "View breakdown"}
          </Btn>
        )}
        <Btn sm variant="ghost" href={`${NEW_HREF}?edit=${e.id}`} className="!px-2 text-blue-600">Edit</Btn>
      </div>
      {open && <Breakdown evaluation={e} />}
    </li>
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return evaluations.filter((e) => !q || e.intern_name?.toLowerCase().includes(q));
  }, [evaluations, search]);

  const setupMissing = formalEnabled && criteriaCount === 0;
  const ready = interns.filter((i) => i.can_evaluate);
  const canCreate = ready.length > 0 && !setupMissing;
  const perIntern = useMemo(() => evaluations.reduce((m, e) => m.set(e.deployment_id, (m.get(e.deployment_id) ?? 0) + 1), new Map()), [evaluations]);
  const newButton = canCreate ? (
    <Btn variant="primary" href={NEW_HREF}>New evaluation</Btn>
  ) : (
    <span className={btnClass("primary")} aria-disabled="true" role="button" tabIndex={0} title={setupMissing ? "Your school has not set up its evaluation criteria yet." : "No intern can be evaluated yet. An intern is evaluated once, after completing the required hours."}>New evaluation</span>
  );

  return (
    <Page>
      <PageHeader title="Evaluations" sentence={formalEnabled ? "Rate interns at your company using your school's evaluation form." : "Give interns at your company an overall score and remarks."}>
        {!loading && newButton}
      </PageHeader>
      {!loading && !canCreate && !setupMissing && interns.length > 0 && (
        <p className="k-note">
          <span className="min-w-0">
            No intern can be evaluated yet. An intern is evaluated once, after completing the required hours.
            {interns.some((i) => i.block_code === "not_finished") ? " Still rendering hours: " + interns.filter((i) => i.block_code === "not_finished").map((i) => `${i.name} (${Number(i.approved_hours)} of ${i.required_hours} hrs)`).join(", ") + "." : ""}
          </span>
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
      ) : error && interns.length === 0 ? null : setupMissing ? (
        <EmptyState icon="check" title="Evaluation criteria not set up" text="Your coordinator has not set up the evaluation criteria yet." />
      ) : interns.length === 0 ? (
        <EmptyState icon="check" title="No interns yet" text="No interns are deployed at your company yet." />
      ) : (
        <>
          {evaluations.length > 0 && (
            <FilterBar>
              <SearchField
                {...inputProps("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search intern…"
                aria-label="Search intern"
              />
            </FilterBar>
          )}
          <Section flush title="Past evaluations" help={`${evaluations.length} submitted`}>
            {evaluations.length === 0 ? (
              <div className="k-pad"><EmptyState icon="evaluations" title="No evaluations yet" text="Evaluations you submit will show up here." action={newButton} /></div>
            ) : visible.length === 0 ? (
              <div className="k-pad"><EmptyState icon="search" title="No matches" text="No evaluations match your search." /></div>
            ) : (
              <ul className="k-list">
                {visible.map((e) => (
                  <EvaluationCard key={e.id} evaluation={e} highlighted={e.id === savedId} several={(perIntern.get(e.deployment_id) ?? 0) > 1} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
