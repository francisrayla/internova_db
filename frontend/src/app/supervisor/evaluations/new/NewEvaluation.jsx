"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";
import { clampOnBlur } from "@/lib/clampNumber";
import { cleanNumber, inputProps } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { todayLocalDate } from "@/lib/timeAgo";
import { EmptyState, ErrorNote, Pill, ProgressBar, SectionTitle, SkeletonList } from "@/components/ui";
import { gradeBand, scoreTone } from "../evalHelpers";

const LIST_HREF = "/supervisor/evaluations";
const TYPES = ["Midterm", "Final"];
const CATEGORY_DESCRIPTIONS = {
  "B. Interpersonal Skills": "The measure of the trainee's ability to relate to one another and to operate within the division where they are assigned through social communication and interaction.",
};

const fieldClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";
const today = () => todayLocalDate();
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Field({ label, children }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1 block font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function CategoryCard({ cat, items, scores, autoFilled, comment, showErrors, onScore, onBlurScore, onComment }) {
  const [commentOpen, setCommentOpen] = useState(Boolean(comment));
  const got = items.reduce((n, c) => n + (Number(scores[c.id]) || 0), 0);
  const max = items.reduce((n, c) => n + Number(c.max_score), 0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{cat}</h3>
          {CATEGORY_DESCRIPTIONS[cat] && <p className="mt-0.5 text-sm text-slate-500">{CATEGORY_DESCRIPTIONS[cat]}</p>}
        </div>
        <span className="shrink-0 text-sm font-semibold text-slate-700">{fmt(got)} / {fmt(max)}</span>
      </div>

      <div className="mt-3 divide-y divide-slate-100">
        {items.map((c) => {
          const missing = showErrors && (scores[c.id] === undefined || scores[c.id] === "");
          const auto = autoFilled[c.id] != null;
          return (
            <div key={c.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{c.name}</p>
                {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                {auto && <p className="mt-0.5 text-xs text-purple-600">Auto-filled from task ratings (avg {autoFilled[c.id]}/10)</p>}
                {missing && <p role="alert" className="mt-0.5 text-xs font-medium text-red-600">Enter a score from 0 to {Number(c.max_score)}.</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-sm text-slate-500">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`${c.name} score`}
                  aria-invalid={missing || undefined}
                  value={scores[c.id] ?? ""}
                  onChange={(e) => onScore(c.id, cleanNumber(e.target.value, { max: Number(c.max_score), decimals: 2 }))}
                  onBlur={(e) => onBlurScore(c.id, clampOnBlur(e.target.value, 0, Number(c.max_score)))}
                  className={`w-16 rounded-lg border px-2 py-2 text-center text-sm outline-none focus:border-blue-500 ${missing ? "border-red-400" : auto ? "border-purple-300 bg-purple-50" : "border-slate-300"}`}
                />
                <span>/ {Number(c.max_score)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {commentOpen ? (
        <textarea
          {...inputProps("note")}
          value={comment}
          onChange={(e) => onComment(cat, e.target.value)}
          placeholder="Comments for this section (optional)"
          aria-label={`${cat} comments`}
          rows={2}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
      ) : (
        <button type="button" onClick={() => setCommentOpen(true)} className="mt-2 text-sm font-semibold text-blue-600 hover:underline">
          Add a comment
        </button>
      )}
    </section>
  );
}

function SummaryCard({ total, max, pct, groups, scores, unscored, formal }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-sm font-semibold text-slate-700">Live summary</p>
      <p className="mt-2 text-xl font-bold text-slate-900">{fmt(total)} <span className="text-sm font-medium text-slate-500">/ {fmt(max)}</span></p>
      <div className="mt-1 flex items-center gap-2">
        <Pill tone={scoreTone(pct)}>{pct.toFixed(0)}%</Pill>
        <span className="text-sm text-slate-600">{gradeBand(pct)}</span>
      </div>
      {formal && (
        <>
          <div className="mt-4 space-y-3">
            {groups.map(([cat, items]) => {
              const got = items.reduce((n, c) => n + (Number(scores[c.id]) || 0), 0);
              const catMax = items.reduce((n, c) => n + Number(c.max_score), 0);
              return (
                <div key={cat}>
                  <div className="mb-1 flex justify-between gap-2 text-xs text-slate-600">
                    <span className="min-w-0 truncate">{cat}</span>
                    <span className="shrink-0">{fmt(got)} / {fmt(catMax)}</span>
                  </div>
                  <ProgressBar pct={catMax ? (got / catMax) * 100 : 0} label={cat} />
                </div>
              );
            })}
          </div>
          <p className={`mt-4 text-sm ${unscored ? "text-amber-700" : "text-emerald-700"}`}>
            {unscored ? `${unscored} criteri${unscored === 1 ? "on" : "a"} still unscored` : "All criteria scored"}
          </p>
        </>
      )}
    </div>
  );
}

export default function NewEvaluation() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useCurrentUser();
  const formal = hasPlanFeature(user, PLAN_FEATURES.FORMAL_EVALUATIONS);

  const [interns, setInterns] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [deploymentId, setDeploymentId] = useState("");
  const [type, setType] = useState("Midterm");
  const [date, setDate] = useState(today);
  const [scores, setScores] = useState({});
  const [autoFilled, setAutoFilled] = useState({});
  const [categoryComments, setCategoryComments] = useState({});
  const [remarks, setRemarks] = useState("");
  const [overall, setOverall] = useState("");

  const [showErrors, setShowErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const dirtyRef = useRef(false);
  const markDirty = () => { dirtyRef.current = true; };

  useEffect(() => {
    Promise.all([fetchSupervisorData("evaluations"), fetchSupervisorData("evaluation-criteria")])
      .then(([evalRes, critRes]) => {
        const list = evalRes.interns ?? [];
        setInterns(list);
        setCriteria(critRes.criteria ?? []);
        const wanted = params.get("intern");
        setDeploymentId(String(list.find((i) => String(i.deployment_id) === wanted)?.deployment_id ?? list[0]?.deployment_id ?? ""));
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggested scores come from the chosen intern's task ratings.
  useEffect(() => {
    if (!formal || !deploymentId) return;
    let cancelled = false;
    apiFetch(`/api/supervisor/evaluation-criteria?deployment_id=${deploymentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = data.criteria ?? [];
        const nextScores = {};
        const nextAuto = {};
        for (const c of list) {
          if (c.suggested_score != null) {
            nextScores[c.id] = String(c.suggested_score);
            nextAuto[c.id] = c.task_rating_average;
          }
        }
        setCriteria(list);
        setScores(nextScores);
        setAutoFilled(nextAuto);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deploymentId, formal]);

  useEffect(() => {
    function warn(e) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const groups = useMemo(() => Object.entries(criteria.reduce((acc, c) => {
    (acc[c.category ?? "Other"] ??= []).push(c);
    return acc;
  }, {})), [criteria]);

  const max = formal ? criteria.reduce((n, c) => n + Number(c.max_score), 0) : 100;
  const total = formal ? criteria.reduce((n, c) => n + (Number(scores[c.id]) || 0), 0) : Number(overall) || 0;
  const pct = max > 0 ? (total / max) * 100 : 0;
  const unscored = formal ? criteria.filter((c) => scores[c.id] === undefined || scores[c.id] === "").length : 0;
  const internName = interns.find((i) => String(i.deployment_id) === String(deploymentId))?.name ?? "this intern";
  const typeLabel = formal ? type : "Manual";

  function leave() {
    if (dirtyRef.current) setLeaveOpen(true);
    else router.push(LIST_HREF);
  }

  function setScore(id, value) {
    markDirty();
    setScores((p) => ({ ...p, [id]: value }));
    setAutoFilled((p) => ({ ...p, [id]: undefined }));
  }

  function requestSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setShowErrors(true);
    if (!deploymentId) return setSubmitError("Select an intern.");
    if (!date) return setSubmitError("Choose the date rated.");
    if (formal ? unscored > 0 : overall === "" || Number(overall) < 0 || Number(overall) > 100) {
      return setSubmitError(formal ? "Score every criterion before submitting." : "Enter an overall score from 0 to 100.");
    }
    setConfirmOpen(true);
  }

  async function submit() {
    setSaving(true);
    setSubmitError("");
    try {
      const body = formal
        ? {
            deployment_id: deploymentId,
            evaluation_type: type,
            evaluation_date: date,
            remarks: remarks.trim() || null,
            category_comments: categoryComments,
            scores: criteria.map((c) => ({ criteria_id: c.id, score: Number(scores[c.id]) || 0 })),
          }
        : { deployment_id: deploymentId, evaluation_date: date, overall_score: Number(overall), remarks: remarks.trim() || null };
      const res = await apiFetch(formal ? "/api/supervisor/evaluations" : "/api/supervisor/evaluations/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not submit evaluation.");
      dirtyRef.current = false;
      router.push(`${LIST_HREF}?saved=${data.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setSaving(false);
    }
  }

  const backLink = (
    <Link href={LIST_HREF} onClick={(e) => { if (dirtyRef.current) { e.preventDefault(); setLeaveOpen(true); } }} className="text-sm font-semibold text-blue-600 hover:underline">
      ← Evaluations
    </Link>
  );

  if (loading) return <div className="space-y-4">{backLink}<SkeletonList rows={3} /></div>;
  if (loadError) return <div className="space-y-4">{backLink}<ErrorNote>{loadError}</ErrorNote></div>;
  if (interns.length === 0) return <div className="space-y-4">{backLink}<EmptyState icon="check" title="No interns yet" text="No interns are deployed at your company yet." /></div>;
  if (formal && criteria.length === 0) return <div className="space-y-4">{backLink}<EmptyState icon="check" title="Evaluation criteria not set up" text="Your coordinator has not set up the evaluation criteria yet." /></div>;

  return (
    <form onSubmit={requestSubmit} noValidate className="space-y-5 pb-24 lg:pb-0">
      <div>
        {backLink}
        <h1 className="mt-1 text-2xl font-bold text-slate-900">New evaluation</h1>
        <p className="mt-1 text-sm text-slate-600">
          {formal ? "Score each criterion. Totals update as you go." : "Give an overall score and remarks. The school's rubric below is a guide for what the score should reflect."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <SectionTitle title="Who and when" />
            <div className={`grid grid-cols-1 gap-3 ${formal ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <Field label="Intern">
                <select value={deploymentId} onChange={(e) => { markDirty(); setDeploymentId(e.target.value); }} className={fieldClass}>
                  {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
                </select>
              </Field>
              {formal && (
                <Field label="Evaluation type">
                  <select value={type} onChange={(e) => { markDirty(); setType(e.target.value); }} className={fieldClass}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Date rated">
                <input type="date" value={date} onChange={(e) => { markDirty(); setDate(e.target.value); }} className={fieldClass} />
              </Field>
            </div>
          </section>

          {formal ? (
            groups.map(([cat, items]) => (
              <CategoryCard
                key={cat}
                cat={cat}
                items={items}
                scores={scores}
                autoFilled={autoFilled}
                comment={categoryComments[cat] ?? ""}
                showErrors={showErrors}
                onScore={setScore}
                onBlurScore={(id, v) => setScores((p) => ({ ...p, [id]: v }))}
                onComment={(c, v) => { markDirty(); setCategoryComments((p) => ({ ...p, [c]: v })); }}
              />
            ))
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <SectionTitle title="Overall score" help="Out of 100." />
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Overall score"
                    value={overall}
                    onChange={(e) => { markDirty(); setOverall(cleanNumber(e.target.value, { max: 100, decimals: 2 })); }}
                    onBlur={(e) => setOverall(clampOnBlur(e.target.value, 0, 100))}
                    className={`w-20 rounded-lg border px-2 py-2 text-center text-sm outline-none focus:border-blue-500 ${showErrors && overall === "" ? "border-red-400" : "border-slate-300"}`}
                  />
                  <span>/ 100</span>
                </div>
                {showErrors && overall === "" && <p role="alert" className="mt-1 text-xs font-medium text-red-600">Enter a score from 0 to 100.</p>}
              </section>
              {groups.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <SectionTitle title="School rubric (guide)" help="Read-only. Your overall score should reflect these." />
                  <div className="space-y-3">
                    {groups.map(([cat, items]) => (
                      <div key={cat}>
                        <p className="text-sm font-semibold text-slate-800">{cat}</p>
                        <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                          {items.map((c) => (
                            <li key={c.id} className="flex justify-between gap-3">
                              <span className="min-w-0">{c.name}</span>
                              <span className="shrink-0 text-slate-500">{Number(c.max_score)} pts</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <Field label={formal ? "In what areas do you recommend this student focus for development?" : "Remarks"}>
              <textarea
                {...inputProps(formal ? "comment" : "longText")}
                value={remarks}
                onChange={(e) => { markDirty(); setRemarks(e.target.value); }}
                rows={4}
                placeholder={formal ? "" : "How did they do?"}
                className={fieldClass}
              />
            </Field>
          </section>

          {submitError && <ErrorNote>{submitError}</ErrorNote>}
          <div className="hidden justify-end gap-2 lg:flex">
            <button type="button" onClick={leave} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">Submit evaluation</button>
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-4 lg:block">
          <SummaryCard total={total} max={max} pct={pct} groups={groups} scores={scores} unscored={unscored} formal={formal} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900">{fmt(total)} / {fmt(max)} <span className="text-sm font-medium text-slate-500">({pct.toFixed(0)}%)</span></p>
          {formal && <p className="truncate text-xs text-slate-500">{unscored ? `${unscored} unscored` : "All scored"}</p>}
        </div>
        <button type="submit" disabled={saving} className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">Submit</button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="primary"
        title={`Submit ${typeLabel} evaluation?`}
        confirmLabel="Submit evaluation"
        busy={saving}
        error={submitError}
        onConfirm={submit}
        onCancel={() => { if (!saving) setConfirmOpen(false); }}
      >
        <p>Submit {typeLabel} evaluation for {internName}? Total {fmt(total)} / {fmt(max)} ({pct.toFixed(0)}%).</p>
        <p>The intern is notified right away. Submitted evaluations can&apos;t be edited, so check the scores first.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveOpen}
        title="Leave without submitting?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={() => { dirtyRef.current = false; router.push(LIST_HREF); }}
        onCancel={() => setLeaveOpen(false)}
      >
        <p>Your scores and comments have not been submitted and will be lost.</p>
      </ConfirmDialog>
    </form>
  );
}
