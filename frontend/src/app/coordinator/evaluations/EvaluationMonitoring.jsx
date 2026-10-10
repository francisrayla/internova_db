"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import EvaluationView from "@/components/EvaluationView";
import Pagination from "@/components/Pagination";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, FormField, Input, Page, PageHeader, SearchField, Section, SheetFrame } from "@/components/dash/page";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { clampOnBlur } from "@/lib/clampNumber";

import { inputProps, cleanNumber } from "@/lib/inputRules";
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
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Add a criterion</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1.4fr_6rem_6rem]">
        <FormField label="Section (optional)" className="col-span-2 sm:col-span-1">
          <Input {...inputProps("shortText")} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. E. Extra" />
        </FormField>
        <FormField label="Criterion name" className="col-span-2 sm:col-span-1">
          <Input {...inputProps("shortText")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Work Attitude" />
        </FormField>
        <FormField label="Max score">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={form.max_score}
            onChange={(e) => setForm((f) => ({ ...f, max_score: cleanNumber(e.target.value, { max: 100 }) }))}
            onBlur={(e) => setForm((f) => ({ ...f, max_score: clampOnBlur(e.target.value, 1, 100) }))}
          />
        </FormField>
        <FormField label="Weight">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={form.weight}
            onChange={(e) => setForm((f) => ({ ...f, weight: cleanNumber(e.target.value, { max: 20, decimals: 1 }) }))}
            onBlur={(e) => setForm((f) => ({ ...f, weight: clampOnBlur(e.target.value, 0.1, 20) }))}
          />
        </FormField>
      </div>
      {error && <p className="k-note is-risk" role="alert">{error}</p>}
      <div className="flex justify-end">
        <Btn type="submit" disabled={saving} className="max-sm:w-full">{saving ? "Adding…" : "Add criterion"}</Btn>
      </div>
    </form>
  );
}

function CriterionPill({ criterion, onEdit, onRemove }) {
  const autoGraded = criterion.category === AUTO_GRADED_CATEGORY;

  return (
    <Pill tone={autoGraded ? "blue" : "slate"}>
      <span>
        {criterion.name} · max {Number(criterion.max_score)}
        {autoGraded && <span title="Score comes from this intern's average task rating"> · auto</span>}
      </span>
      <button type="button" onClick={() => onEdit(criterion)} className="ml-1.5 underline max-sm:min-h-[28px]" aria-label={`Edit ${criterion.name}`}>Edit</button>
      <button type="button" onClick={() => onRemove(criterion)} className="ml-1.5 underline max-sm:min-h-[28px]" aria-label={`Remove ${criterion.name}`}>Remove</button>
    </Pill>
  );
}

// Fixes a criterion's wording; its points are locked by the server once an evaluation has used it.
function EditCriterionSheet({ criterion, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: criterion.name,
    category: criterion.category ?? "",
    max_score: String(Number(criterion.max_score)),
    weight: String(Number(criterion.weight)),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter a criterion name.");
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/evaluation-criteria/${criterion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), category: form.category.trim() || null, max_score: form.max_score, weight: form.weight }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the criterion.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      title="Edit criterion"
      onClose={saving ? undefined : onClose}
      onSubmit={submit}
      footer={
        <>
          <Btn onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="Section (optional)">
          <Input {...inputProps("shortText")} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
        </FormField>
        <FormField label="Criterion name">
          <Input {...inputProps("shortText")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Max score">
            <Input type="text" inputMode="numeric" autoComplete="off" value={form.max_score} onChange={(e) => setForm((f) => ({ ...f, max_score: cleanNumber(e.target.value, { max: 100 }) }))} onBlur={(e) => setForm((f) => ({ ...f, max_score: clampOnBlur(e.target.value, 1, 100) }))} />
          </FormField>
          <FormField label="Weight">
            <Input type="text" inputMode="decimal" autoComplete="off" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: cleanNumber(e.target.value, { max: 20, decimals: 1 }) }))} onBlur={(e) => setForm((f) => ({ ...f, weight: clampOnBlur(e.target.value, 0.1, 20) }))} />
          </FormField>
        </div>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // criterion being edited
  const [removing, setRemoving] = useState(null); // criterion waiting for a remove confirmation
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const requestRef = useRef(0);

  async function removeCriterion() {
    setRemoveBusy(true);
    setRemoveError("");
    try {
      const res = await apiFetch(`/api/coordinator/evaluation-criteria/${removing.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not remove the criterion.");
      setRemoving(null);
      loadCriteria();
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
      setLoading(true);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // The server pages the evaluations and searches the whole set by intern name.
  function loadEvaluations(nextPage = page) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`evaluations?${params}`)
      .then((evalRes) => {
        if (request !== requestRef.current) return;
        setEvaluations(evalRes.evaluations ?? []);
        setMeta({ total: evalRes.total ?? 0, last_page: evalRes.last_page ?? 1 });
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        setError(e.message);
        setLoading(false);
      });
  }

  function goToPage(next) {
    setLoading(true);
    setPage(next);
  }

  function loadCriteria() {
    fetchCoordinatorData("evaluation-criteria")
      .then((critRes) => setCriteria(critRes.criteria ?? []))
      .catch((e) => setError(e.message));
  }

  function load() {
    loadCriteria();
    loadEvaluations();
  }

  useEffect(loadCriteria, []);
  useEffect(() => {
    loadEvaluations(page);
  }, [page, debouncedSearch]);

  const criteriaByCategory = useMemo(() => {
    return criteria.reduce((acc, c) => {
      (acc[c.category ?? "Other"] ??= []).push(c);
      return acc;
    }, {});
  }, [criteria]);

  const criteriaTotal = criteria.reduce((n, c) => n + Number(c.max_score), 0);

  return (
    <Page>
      <PageHeader title="Evaluations" sentence="Manage the school scoring rubric — supervisors submit the actual evaluations." />

      <Section title={`Evaluation criteria (${criteria.length})`} help="Supervisors score each intern against these.">
        {criteria.length > 0 && (
          <div className="mb-4 space-y-3">
            {Object.entries(criteriaByCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map((c) => (
                    <CriterionPill key={c.id} criterion={c} onEdit={setEditing} onRemove={(x) => { setRemoveError(""); setRemoving(x); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {criteria.length > 0 && criteriaTotal !== 100 && (
          <p className="k-note is-warn mb-4">
            Your criteria add up to {criteriaTotal} points. Most OJT forms use 100.
          </p>
        )}
        <div className={criteria.length > 0 ? "border-t border-slate-200 pt-4" : ""}>
          <NewCriterionForm onSaved={load} />
        </div>
      </Section>

      {(meta.total > 0 || debouncedSearch) && (
        <FilterBar>
          <SearchField
            {...inputProps("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by intern name…"
            aria-label="Search evaluations by intern name"
          />
        </FilterBar>
      )}

      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      {loading && evaluations.length === 0 ? (
        <section className="dash-card"><SkeletonList rows={2} height="h-20" /></section>
      ) : evaluations.length === 0 && !debouncedSearch ? (
        <section className="dash-card"><EmptyState icon="evaluations" title="No evaluations submitted yet." text="Evaluations appear here once supervisors submit them." /></section>
      ) : evaluations.length === 0 ? (
        <section className="dash-card"><p className="py-6 text-center text-sm text-slate-500">No evaluations match your search.</p></section>
      ) : (
        <div className="space-y-4">
          {evaluations.map((e) => (
            <Section key={e.id} title={e.intern_name}>
              <EvaluationView evaluation={e} />
            </Section>
          ))}
          <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={loading} onPageChange={goToPage} />
        </div>
      )}

      {editing && <EditCriterionSheet criterion={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadCriteria(); }} />}
      <ConfirmDialog
        open={!!removing}
        title="Remove this criterion?"
        confirmLabel="Remove"
        busy={removeBusy}
        error={removeError}
        onConfirm={removeCriterion}
        onCancel={() => setRemoving(null)}
      >
        <p>&quot;{removing?.name}&quot; will no longer appear on new evaluations. Evaluations already submitted keep their scores.</p>
      </ConfirmDialog>
    </Page>
  );
}
