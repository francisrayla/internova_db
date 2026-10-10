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
import NavIcon from "@/components/NavIcon";
import { EmptyState, ErrorNote, Pill, ProgressBar, SkeletonList } from "@/components/ui";
import { Btn, Page, Section } from "@/components/dash/page";
import { gradeBand, scoreTone } from "../evalHelpers";

const LIST_HREF = "/supervisor/evaluations";
const CATEGORY_DESCRIPTIONS = {
  "B. Interpersonal Skills": "The measure of the trainee's ability to relate to one another and to operate within the division where they are assigned through social communication and interaction.",
};

const fieldClass = "k-input";
const scoreClass = "k-input !px-2 text-center";
const today = () => todayLocalDate();
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "120 of 480 hrs" for an intern who has not finished yet. */
const hoursLabel = (i) => `${fmt(Number(i.approved_hours) || 0)} of ${i.required_hours || "?"} hrs`;

/** Picker text: an intern who cannot be picked says why right in the option. */
function optionLabel(i) {
  if (i.can_evaluate) return i.name;
  if (i.block_code === "already_evaluated") return `${i.name} (already evaluated, edit it instead)`;
  return `${i.name} (${hoursLabel(i)})`;
}

function Field({ label, children }) {
  return (
    <label className="k-field">
      <span className="k-label">{label}</span>
      {children}
    </label>
  );
}

function CategoryCard({ cat, items, scores, autoFilled, suggestions, comment, showErrors, onScore, onBlurScore, onComment }) {
  const [commentOpen, setCommentOpen] = useState(Boolean(comment));
  const got = items.reduce((n, c) => n + (Number(scores[c.id]) || 0), 0);
  const max = items.reduce((n, c) => n + Number(c.max_score), 0);

  return (
    <Section
      title={cat}
      help={CATEGORY_DESCRIPTIONS[cat]}
      action={<span className="shrink-0 text-sm font-semibold text-slate-700">{fmt(got)} / {fmt(max)}</span>}
    >
      <div className="divide-y divide-slate-100">
        {items.map((c) => {
          const missing = showErrors && (scores[c.id] === undefined || scores[c.id] === "");
          const auto = autoFilled[c.id] != null;
          const suggested = suggestions[c.id];
          return (
            <div key={c.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{c.name}</p>
                {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                {auto && <p className="mt-0.5 text-xs text-[var(--ui-info)]">Auto-filled from task ratings (avg {autoFilled[c.id]}/10)</p>}
                {suggested != null && (
                  <p className="mt-0.5 text-xs text-[var(--ui-info)]">
                    Task ratings suggest {suggested}.{" "}
                    <button type="button" onClick={() => onScore(c.id, String(suggested))} className="font-semibold underline max-sm:min-h-[44px]">Use it</button>
                  </p>
                )}
                {missing && <p role="alert" className="mt-0.5 text-xs font-medium text-[var(--ui-risk)]">Enter a score from 0 to {Number(c.max_score)}.</p>}
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
                  className={`${scoreClass} !w-[4.5rem] ${auto && !missing ? "!bg-[var(--ui-info-bg)]" : ""}`}
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
          className="k-input mt-3"
        />
      ) : (
        <button type="button" onClick={() => setCommentOpen(true)} className="mt-2 inline-flex items-center text-sm font-semibold text-blue-600 hover:underline max-sm:min-h-[44px]">
          Add a comment
        </button>
      )}
    </Section>
  );
}

function SummaryCard({ total, max, pct, groups, scores, unscored, formal }) {
  return (
    <Section title="Live summary">
      <p className="text-xl font-semibold text-slate-900">{fmt(total)} <span className="text-sm font-medium text-slate-500">/ {fmt(max)}</span></p>
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
    </Section>
  );
}

/** Interns who cannot be picked, each with the reason (hours still to render, or already evaluated). */
function UnavailableInterns({ interns }) {
  if (interns.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-xs font-semibold text-slate-600">Cannot be evaluated right now</p>
      <ul className="mt-1 space-y-1.5">
        {interns.map((i) => (
          <li key={i.deployment_id} className="text-sm text-slate-600">
            <span className="font-medium text-slate-800">{i.name}</span>
            {i.block_code === "already_evaluated" ? (
              <>
                {": already evaluated. "}
                {i.evaluation_id && <Link href={`${LIST_HREF}/new?edit=${i.evaluation_id}`} className="font-semibold text-blue-600 hover:underline">Edit it</Link>}
              </>
            ) : (
              <>: {hoursLabel(i)} rendered. Available once the required hours are completed.</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NewEvaluation() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useCurrentUser();
  const planFormal = hasPlanFeature(user, PLAN_FEATURES.FORMAL_EVALUATIONS);
  const editId = Number(params.get("edit")) || null;

  const [interns, setInterns] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [editEval, setEditEval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [deploymentId, setDeploymentId] = useState("");
  const [date, setDate] = useState(today);
  const [scores, setScores] = useState({});
  const [autoFilled, setAutoFilled] = useState({});
  const [suggestions, setSuggestions] = useState({});
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

  // Editing an evaluation keeps the kind it was submitted as: scored per criterion, or one overall score.
  const formal = editEval ? editEval.scores.length > 0 : planFormal;

  useEffect(() => {
    Promise.all([fetchSupervisorData("evaluations"), fetchSupervisorData("evaluation-criteria")])
      .then(([evalRes, critRes]) => {
        const list = evalRes.interns ?? [];
        setInterns(list);
        setCriteria(critRes.criteria ?? []);
        if (editId) {
          const ev = (evalRes.evaluations ?? []).find((e) => e.id === editId);
          if (!ev) {
            setLoadError("This evaluation was not found. It may belong to another company.");
            return;
          }
          setEditEval(ev);
          setDeploymentId(String(ev.deployment_id));
          setDate(ev.evaluation_date_raw || today());
          setRemarks(ev.remarks ?? "");
          setCategoryComments(ev.category_comments ?? {});
          setOverall(ev.overall_score != null ? String(Number(ev.overall_score)) : "");
          return;
        }
        const wanted = params.get("intern");
        const ready = list.filter((i) => i.can_evaluate);
        setDeploymentId(String(ready.find((i) => String(i.deployment_id) === wanted)?.deployment_id ?? ready[0]?.deployment_id ?? ""));
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Task-rating suggestions for the chosen intern. A new evaluation starts from them; an edit keeps the
  // saved scores, prefilled, and only offers the suggestion next to a criterion that differs.
  useEffect(() => {
    if (!formal || !deploymentId || loading) return;
    let cancelled = false;
    apiFetch(`/api/supervisor/evaluation-criteria?deployment_id=${deploymentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const active = data.criteria ?? [];
        const nextScores = {};
        const nextAuto = {};
        const nextSuggest = {};
        let list = active;
        if (editEval) {
          const saved = new Map(editEval.scores.map((s) => [s.criteria_id, s]));
          // A criterion that was scored but is no longer active is still part of this evaluation.
          list = [
            ...active,
            ...editEval.scores
              .filter((s) => !active.some((c) => c.id === s.criteria_id))
              .map((s) => ({ id: s.criteria_id, name: s.criterion_name, category: s.category, max_score: s.max_score, description: null, suggested_score: null, task_rating_average: null })),
          ];
          for (const c of list) {
            const s = saved.get(c.id);
            if (s) {
              nextScores[c.id] = String(Number(s.score));
              if (c.suggested_score != null && Number(c.suggested_score) !== Number(s.score)) nextSuggest[c.id] = c.suggested_score;
            } else if (c.suggested_score != null) {
              nextScores[c.id] = String(c.suggested_score);
              nextAuto[c.id] = c.task_rating_average;
            }
          }
        } else {
          for (const c of list) {
            if (c.suggested_score != null) {
              nextScores[c.id] = String(c.suggested_score);
              nextAuto[c.id] = c.task_rating_average;
            }
          }
        }
        setCriteria(list);
        setScores(nextScores);
        setAutoFilled(nextAuto);
        setSuggestions(nextSuggest);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deploymentId, formal, loading, editEval]);

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
  const selected = interns.find((i) => String(i.deployment_id) === String(deploymentId));
  const internName = editEval?.intern_name ?? selected?.name ?? "this intern";
  const unavailable = interns.filter((i) => !i.can_evaluate);
  const noOneReady = !editId && !interns.some((i) => i.can_evaluate);

  function leave() {
    if (dirtyRef.current) setLeaveOpen(true);
    else router.push(LIST_HREF);
  }

  function setScore(id, value) {
    markDirty();
    setScores((p) => ({ ...p, [id]: value }));
    setAutoFilled((p) => ({ ...p, [id]: undefined }));
    setSuggestions((p) => ({ ...p, [id]: undefined }));
  }

  function requestSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setShowErrors(true);
    if (!deploymentId) return setSubmitError("Select an intern.");
    if (!editId && selected && !selected.can_evaluate) return setSubmitError(selected.block_reason || "This intern cannot be evaluated yet.");
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
      const savedRemarks = new Map((editEval?.scores ?? []).map((s) => [s.criteria_id, s.remarks]));
      const common = { evaluation_date: date, remarks: remarks.trim() || null };
      const body = formal
        ? {
            ...common,
            category_comments: categoryComments,
            scores: criteria.map((c) => ({ criteria_id: c.id, score: Number(scores[c.id]) || 0, remarks: savedRemarks.get(c.id) ?? null })),
          }
        : { ...common, overall_score: Number(overall) };
      if (!editId) body.deployment_id = deploymentId;
      const url = editId ? `/api/supervisor/evaluations/${editId}` : planFormal ? "/api/supervisor/evaluations" : "/api/supervisor/evaluations/manual";
      const res = await apiFetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the evaluation.");
      dirtyRef.current = false;
      router.push(`${LIST_HREF}?saved=${data.id}${editId ? "&edited=1" : ""}`);
    } catch (err) {
      setSubmitError(err.message);
      setSaving(false);
    }
  }

  const backLink = (
    <Link href={LIST_HREF} onClick={(e) => { if (dirtyRef.current) { e.preventDefault(); setLeaveOpen(true); } }} className="k-back">
      <NavIcon name="back" size={16} />
      Evaluations
    </Link>
  );

  if (loading) return <Page><div>{backLink}</div><SkeletonList rows={3} /></Page>;
  if (loadError) return <Page><div>{backLink}</div><ErrorNote>{loadError}</ErrorNote></Page>;
  if (interns.length === 0 && !editId) return <Page><div>{backLink}</div><EmptyState icon="users" title="No interns yet" text="No interns are deployed at your company yet." /></Page>;
  if (formal && criteria.length === 0 && !editId) return <Page><div>{backLink}</div><EmptyState icon="evaluations" title="Evaluation criteria not set up" text="Your coordinator has not set up the evaluation criteria yet." /></Page>;
  if (noOneReady) {
    return (
      <Page>
        <header className="k-head">
          <div className="k-head-text">
            {backLink}
            <h1>New evaluation</h1>
          </div>
        </header>
        <Section title="No intern can be evaluated yet" help="An intern can be evaluated once the required hours are completed, and each intern is evaluated once (you can edit it later).">
          <UnavailableInterns interns={unavailable} />
        </Section>
      </Page>
    );
  }

  return (
    <form onSubmit={requestSubmit} noValidate>
    <Page className="pb-24 lg:pb-0">
      <header className="k-head">
        <div className="k-head-text">
          {backLink}
          <h1>{editId ? "Edit evaluation" : "New evaluation"}</h1>
          <p>
            {editId
              ? `Change the scores or remarks for ${internName}. The total is recalculated and ${internName.split(" ")[0] || "the intern"} is told it was updated.`
              : formal ? "Score each criterion. Totals update as you go." : "Give an overall score and remarks. The school's rubric below is a guide for what the score should reflect."}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Section title="Who and when">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Intern">
                {editId ? (
                  <p className="k-input !bg-[var(--ui-soft)]">{internName}</p>
                ) : (
                  <select value={deploymentId} onChange={(e) => { markDirty(); setDeploymentId(e.target.value); }} className={fieldClass}>
                    {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id} disabled={!i.can_evaluate}>{optionLabel(i)}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Date rated">
                <input type="date" value={date} onChange={(e) => { markDirty(); setDate(e.target.value); }} className={fieldClass} />
              </Field>
            </div>
            {!editId && selected?.can_evaluate && (
              <p className="mt-2 text-xs text-emerald-700">
                {selected.finished && Number(selected.approved_hours) < selected.required_hours
                  ? "Internship marked completed."
                  : `Required hours completed (${hoursLabel(selected)}).`}
              </p>
            )}
            {!editId && <UnavailableInterns interns={unavailable} />}
          </Section>

          {formal ? (
            groups.map(([cat, items]) => (
              <CategoryCard
                key={cat}
                cat={cat}
                items={items}
                scores={scores}
                autoFilled={autoFilled}
                suggestions={suggestions}
                comment={categoryComments[cat] ?? ""}
                showErrors={showErrors}
                onScore={setScore}
                onBlurScore={(id, v) => setScores((p) => ({ ...p, [id]: v }))}
                onComment={(c, v) => { markDirty(); setCategoryComments((p) => ({ ...p, [c]: v })); }}
              />
            ))
          ) : (
            <>
              <Section title="Overall score" help="Out of 100.">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Overall score"
                    aria-invalid={(showErrors && overall === "") || undefined}
                    value={overall}
                    onChange={(e) => { markDirty(); setOverall(cleanNumber(e.target.value, { max: 100, decimals: 2 })); }}
                    onBlur={(e) => setOverall(clampOnBlur(e.target.value, 0, 100))}
                    className={`${scoreClass} !w-24`}
                  />
                  <span>/ 100</span>
                </div>
                {showErrors && overall === "" && <p role="alert" className="mt-1 text-xs font-medium text-[var(--ui-risk)]">Enter a score from 0 to 100.</p>}
              </Section>
              {groups.length > 0 && (
                <Section title="School rubric (guide)" help="Read-only. Your overall score should reflect these.">
                  <div className="space-y-4">
                    {groups.map(([cat, items]) => (
                      <div key={cat}>
                        <p className="text-sm font-semibold text-slate-800">{cat}</p>
                        <ul className="mt-1 divide-y divide-slate-100 text-sm text-slate-600">
                          {items.map((c) => (
                            <li key={c.id} className="flex justify-between gap-3 py-1.5">
                              <span className="min-w-0 break-words">{c.name}</span>
                              <span className="shrink-0 text-slate-500">{Number(c.max_score)} pts</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          <Section>
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
          </Section>

          {submitError && <ErrorNote>{submitError}</ErrorNote>}
          <div className="hidden justify-end gap-2 lg:flex">
            <Btn onClick={leave}>Cancel</Btn>
            <Btn variant="primary" type="submit" disabled={saving}>{editId ? "Save changes" : "Submit evaluation"}</Btn>
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-4 lg:block">
          <SummaryCard total={total} max={max} pct={pct} groups={groups} scores={scores} unscored={unscored} formal={formal} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">{fmt(total)} / {fmt(max)} <span className="text-sm font-medium text-slate-500">({pct.toFixed(0)}%)</span></p>
          {formal && <p className="truncate text-xs text-slate-500">{unscored ? `${unscored} unscored` : "All scored"}</p>}
        </div>
        <Btn variant="primary" type="submit" disabled={saving} className="shrink-0">{editId ? "Save" : "Submit"}</Btn>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="primary"
        title={editId ? "Save changes to this evaluation?" : "Submit evaluation?"}
        confirmLabel={editId ? "Save changes" : "Submit evaluation"}
        busy={saving}
        error={submitError}
        onConfirm={submit}
        onCancel={() => { if (!saving) setConfirmOpen(false); }}
      >
        <p>{editId ? `Save the changes to the evaluation of ${internName}?` : `Submit the evaluation for ${internName}?`} Total {fmt(total)} / {fmt(max)} ({pct.toFixed(0)}%).</p>
        <p>{editId ? "The intern is told that it was updated." : "The intern is notified right away. Each intern is evaluated once, but you can edit it later."}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveOpen}
        title={editId ? "Leave without saving?" : "Leave without submitting?"}
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={() => { dirtyRef.current = false; router.push(LIST_HREF); }}
        onCancel={() => setLeaveOpen(false)}
      >
        <p>{editId ? "Your changes have not been saved and will be lost." : "Your scores and comments have not been submitted and will be lost."}</p>
      </ConfirmDialog>
    </Page>
    </form>
  );
}
