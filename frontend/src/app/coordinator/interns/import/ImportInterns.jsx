"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Btn, FormField, Input, KeyValueList, Page, PageHeader, Section, Select } from "@/components/dash/page";
import { apiFetch } from "@/lib/apiFetch";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { clean } from "@/lib/inputRules";
import { YEAR_LEVEL_OPTIONS } from "@/lib/internOptions";
import { hoursForOffered, useSchoolCourses } from "@/lib/schoolCourses";
import { START_DATE_HINT, startDateBounds } from "@/lib/startDateWindow";
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  cleanRow,
  downloadTemplate,
  readInternFile,
  validateRows,
} from "@/lib/internImport";

const STEPS = ["Upload file", "Review", "Deploy & invite"];

/** The corrected address out of a "Did you mean juan@gmail.com?" message. */
function suggestedEmail(message) {
  return message?.match(/Did you mean ([^\s?]+@[^\s?]+)\?/)?.[1] ?? null;
}

const cellBase = "k-input !min-h-0 !py-1.5";
const cellOk = "";
const cellBad = "";

function Stepper({ step }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto no-scrollbar">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <span
              className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {state === "done" ? <Icon name="check" size={14} /> : n}
            </span>
            {/* Phones show only the current step's name; numbers carry the rest. */}
            <span className={`text-sm font-medium ${state === "todo" ? "text-slate-600" : "text-slate-900"} ${state === "current" ? "" : "hidden sm:inline"}`}>{label}</span>
            {n < STEPS.length && <span className="mx-1 h-px w-6 bg-slate-200 sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

function UploadStep({ onLoaded, courses }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      const result = await readInternFile(file, courses.canonical);
      onLoaded({ fileName: file.name, ...result });
    } catch (err) {
      setError(err.message || "This file couldn't be read.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleTemplate() {
    setTemplateBusy(true);
    try {
      await downloadTemplate(courses.offered);
    } finally {
      setTemplateBusy(false);
    }
  }

  if (courses.loading) {
    return <p className="text-sm text-slate-600" role="status">Loading your school&apos;s courses…</p>;
  }
  if (courses.error) {
    return <p role="alert" className="k-note is-risk">{courses.error}</p>;
  }
  if (courses.offered.length === 0) {
    return (
      <Section title="Set up your courses first">
        <p className="k-note is-warn">
          <span>
            Your school hasn&apos;t set up its courses yet. Only the courses your school offers can be imported.{" "}
            <Link href="/coordinator/settings/courses" className="font-semibold underline">Open Settings, Courses offered</Link>, pick them, then come back.
          </span>
        </p>
      </Section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          disabled={reading}
          className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition sm:py-16 ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50"
          }`}
        >
          <span className="text-slate-500">
            <Icon name="upload" size={28} />
          </span>
          <span className="mt-3 text-base font-semibold text-slate-900">
            {reading ? "Reading your file…" : "Drop your masterlist here"}
          </span>
          <span className="mt-1 text-sm text-slate-600">
            or <span className="font-semibold text-blue-600">browse your files</span>
          </span>
          <span className="mt-3 text-xs text-slate-600">Excel (.xlsx) or CSV · up to {IMPORT_MAX_ROWS} interns</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {error && (
          <p role="alert" className="k-note is-risk mt-3">{error}</p>
        )}
      </div>

      <Section title="Prepare your file" help="Start from the template, or upload the school's own masterlist — columns are matched by their headings.">
        <div className="space-y-4">
          <Btn block onClick={handleTemplate} disabled={templateBusy}>
            <Icon name="download" size={16} /> {templateBusy ? "Preparing…" : "Download template (.xlsx)"}
          </Btn>

          <KeyValueList
            items={[
              { label: "First name", value: "Required" },
              { label: "Last name", value: "Required" },
              { label: "Email", value: "Required" },
              { label: "Course", value: "Required" },
              { label: "Year level", value: "Optional · 4th Year if blank" },
            ]}
          />
          <div>
            <p className="k-hint">
              Courses your school offers (the code or the full name works, the full name is saved):
            </p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-slate-800" aria-label="Courses your school offers">
              {courses.offered.map((c) => (
                <li key={c.name} className="break-words">{c.code && <span className="font-mono text-xs text-slate-600">{c.code} · </span>}{c.name}</li>
              ))}
            </ul>
            <p className="k-hint mt-2">
              A single &quot;Name&quot; column written as &quot;Dela Cruz, Juan&quot; works too. To change this list, go to{" "}
              <Link href="/coordinator/settings/courses" className="font-semibold underline">Settings, Courses offered</Link>.
            </p>
          </div>
          <p className="k-note">
            <span className="flex gap-2">
              <Icon name="user" size={14} className="mt-0.5 shrink-0" />
              No student numbers needed — each intern enters their own when they activate their account.
            </span>
          </p>
        </div>
      </Section>
    </div>
  );
}

function ReviewStep({ fileName, skippedSample, rows, setRows, errors, existing, checking, onBack, onContinue, courses }) {
  const [onlyProblemsToggle, setOnlyProblems] = useState(false);
  const problemCount = Object.keys(errors).length;
  // Interns already in this school are listed but skipped — re-uploading the
  // same masterlist with a few new names only adds the new ones.
  const existingCount = rows.filter((r) => existing.has(r.key)).length;
  const newCount = rows.length - existingCount;
  const readyCount = newCount - problemCount;
  // The filter switches itself off once nothing is left to fix.
  const onlyProblems = onlyProblemsToggle && problemCount > 0;
  const visible = onlyProblems ? rows.filter((r) => errors[r.key]) : rows;

  function update(key, field, value) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function tidy(key) {
    setRows((prev) => prev.map((r) => (r.key === key ? { key: r.key, ...cleanRow(r, courses.canonical) } : r)));
  }

  function remove(key) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const FIELD_RULES = { first_name: "personName", last_name: "personName", email: "email" };

  function renderField(row, field, position, rowErrors) {
    if (existing.has(row.key)) {
      return <p className="break-words px-2.5 py-1.5 text-sm text-slate-600">{row[field] || "—"}</p>;
    }
    const error = rowErrors[field];
    const className = `${cellBase} ${error ? cellBad : cellOk}`;
    const label = `${FIELD_LABELS[field]}, row ${position}`;
    return (
      <>
        {field === "year_level" ? (
          <select aria-label={label} aria-invalid={Boolean(error)} value={row.year_level} onChange={(e) => update(row.key, "year_level", e.target.value)} className={className}>
            {!YEAR_LEVEL_OPTIONS.includes(row.year_level) && <option value={row.year_level} disabled>{row.year_level || "Choose…"}</option>}
            {YEAR_LEVEL_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        ) : (
          <input
            aria-label={label}
            aria-invalid={Boolean(error)}
            value={row[field]}
            onChange={(e) => update(row.key, field, FIELD_RULES[field] ? clean(FIELD_RULES[field], e.target.value) : e.target.value)}
            onBlur={() => tidy(row.key)}
            list={field === "course" ? "import-course-options" : undefined}
            title={field === "course" ? row.course : undefined}
            inputMode={field === "email" ? "email" : undefined}
            className={className}
          />
        )}
        {error && <p className="k-error mt-1 px-1 !text-xs">{error}</p>}
        {suggestedEmail(error) && (
          <button
            type="button"
            onClick={() => update(row.key, "email", suggestedEmail(error))}
            className="mt-0.5 px-1 text-xs font-semibold text-blue-600 hover:underline max-sm:min-h-[44px]"
          >
            Use {suggestedEmail(error)}
          </button>
        )}
      </>
    );
  }

  function removeProblems() {
    setRows((prev) => prev.filter((r) => !errors[r.key]));
    setOnlyProblems(false);
  }

  return (
    <div className="space-y-4">
      <section className="dash-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-slate-500">
              <Icon name="file" size={20} />
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-900">{fileName}</p>
              <p className="text-xs text-slate-600">
                {rows.length} intern{rows.length === 1 ? "" : "s"} found{skippedSample ? " · example row skipped" : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="k-pill is-ok">
              <Icon name="check" size={12} /> {readyCount} new
            </span>
            {existingCount > 0 && (
              <span className="k-pill" title="Already in Internova — these are skipped">
                {existingCount} already added
              </span>
            )}
            {problemCount > 0 && (
              <button
                type="button"
                onClick={() => setOnlyProblems((v) => !v)}
                aria-pressed={onlyProblems}
                className={`k-pill is-risk max-sm:min-h-[44px] ${onlyProblems ? "ring-2 ring-red-600" : ""}`}
              >
                {problemCount} need{problemCount === 1 ? "s" : ""} fixing {onlyProblems ? "· show all" : "· show only these"}
              </button>
            )}
            {checking && <span className="text-xs text-slate-600">Checking against existing accounts…</span>}
          </div>
        </div>
      </section>

      <datalist id="import-course-options">
        {courses.offered.map((c) => <option key={c.name} value={c.name} />)}
      </datalist>

      {/* Phones and small tablets: one card per intern, every field labelled. */}
      <div className="space-y-3 md:hidden">
        {visible.map((row) => {
          const rowErrors = errors[row.key] ?? {};
          const position = rows.indexOf(row) + 1;
          const isExisting = existing.has(row.key);
          return (
            <article key={row.key} className={`dash-card ${isExisting ? "!bg-slate-50" : ""}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  Intern {position}
                  {isExisting && <span className="k-pill is-sm ml-2">Already added</span>}
                </span>
                <button type="button" onClick={() => remove(row.key)} aria-label={`Remove row ${position}`} className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field} className={field === "email" || field === "course" ? "col-span-2 block" : "block"}>
                    <span className="k-label mb-1 block">{FIELD_LABELS[field]}</span>
                    {renderField(row, field, position, rowErrors)}
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {/* Larger screens: an editable table. */}
      <section className="dash-card is-flush hidden md:block">
        <div className="k-tablewrap">
          <table className="k-table w-full min-w-[860px] table-fixed">
            <colgroup>
              <col className="w-12" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[34%]" />
              <col className="w-[12%]" />
              <col className="w-14" />
            </colgroup>
            <thead>
              <tr>
                <th className="text-center">#</th>
                {IMPORT_FIELDS.map((f) => <th key={f}>{FIELD_LABELS[f]}</th>)}
                <th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const rowErrors = errors[row.key] ?? {};
                const position = rows.indexOf(row) + 1;
                return (
                  <tr key={row.key} className={existing.has(row.key) ? "bg-slate-50" : ""}>
                    <td className="!px-2 text-center align-top text-xs font-medium text-slate-600">
                      {position}
                      {existing.has(row.key) && <span className="mt-1 block text-xs font-semibold leading-tight text-slate-600">Already added</span>}
                    </td>
                    {IMPORT_FIELDS.map((field) => (
                      <td key={field} className="!px-1.5 !py-2 align-top">{renderField(row, field, position, rowErrors)}</td>
                    ))}
                    <td className="!px-2 align-top">
                      <button
                        type="button"
                        onClick={() => remove(row.key)}
                        aria-label={`Remove row ${position}`}
                        title="Remove this intern"
                        className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {rows.length === 0 && (
        <p className="k-empty text-sm text-slate-600">Every row was removed. Upload the file again to start over.</p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Btn onClick={onBack}>Upload a different file</Btn>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {problemCount > 0 && (
            <Btn variant="danger-quiet" onClick={removeProblems}>
              Remove {problemCount} row{problemCount === 1 ? "" : "s"} with problems
            </Btn>
          )}
          <Btn variant="primary" onClick={onContinue} disabled={problemCount > 0 || newCount === 0 || checking}>
            Continue with {newCount} new intern{newCount === 1 ? "" : "s"}
          </Btn>
        </div>
      </div>
      {problemCount > 0 ? (
        <p className="k-hint sm:text-right">Fix the highlighted cells or remove those rows to continue.</p>
      ) : newCount === 0 && existingCount > 0 ? (
        <p className="k-hint sm:text-right">Everyone in this file is already in Internova — add new names to the list to import them.</p>
      ) : null}
    </div>
  );
}

function DeployStep({ rows, companies, onBack, onImported, courses }) {
  const activeCompanies = companies.filter((c) => c.status === "active");
  const [form, setForm] = useState({ company_id: activeCompanies.length === 1 ? String(activeCompanies[0].id) : "", start_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const byCourse = useMemo(() => {
    const groups = new Map();
    for (const r of rows) groups.set(r.course, (groups.get(r.course) ?? 0) + 1);
    return [...groups.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.company_id || !form.start_date) {
      setError("Choose a company and a start date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/intern-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(({ key, ...r }) => r),
          company_id: Number(form.company_id),
          start_date: form.start_date,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const err = new Error(data.message || "The import couldn't be completed.");
        err.rowErrors = data.errors;
        throw err;
      }
      onImported({ created: data.created, company: activeCompanies.find((c) => String(c.id) === form.company_id)?.company_name });
    } catch (err) {
      if (err.rowErrors) onBack(err.rowErrors);
      else setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Section title="Where are they deployed?" help="Applies to everyone in this batch. Import another file for interns going to a different company.">
        {activeCompanies.length === 0 ? (
          <p className="k-note is-warn">
            <span>You don&apos;t have an active partner company yet. <Link href="/coordinator/companies" className="font-semibold underline">Add one</Link> first, then come back.</span>
          </p>
        ) : (
          <div className="space-y-4">
            <FormField label="Company">
              <Select value={form.company_id} onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}>
                <option value="">Select a company…</option>
                {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </Select>
            </FormField>
            <CompanySupervisorsNote companyId={form.company_id} companyName={activeCompanies.find((c) => String(c.id) === String(form.company_id))?.company_name} />
            <FormField label="Start date" hint={START_DATE_HINT}>
              <Input type="date" value={form.start_date} min={startDateBounds().min} max={startDateBounds().max} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </FormField>
          </div>
        )}
      </Section>

      <Section title="Summary" className="flex flex-col">
        <div className="flex flex-1 flex-col">
          <p className="text-3xl font-semibold text-slate-900">{rows.length}</p>
          <p className="text-sm text-slate-600">intern account{rows.length === 1 ? "" : "s"} to create</p>

          <ul className="mt-4 divide-y divide-slate-200 text-sm">
            {byCourse.map(([course, count]) => (
              <li key={course} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-slate-800">
                  {course}
                  {courses.offered.find((c) => c.name === course)?.custom && <span className="ml-1.5 text-xs text-slate-600">(own program)</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-600">{count} · {hoursForOffered(courses.offered, courses.canonical, course)} h each</span>
              </li>
            ))}
          </ul>

          <p className="k-note mt-4">
            <span className="flex gap-2">
              <Icon name="mail" size={14} className="mt-0.5 shrink-0" />
              Each intern gets an email to set their own password. Emails go out a second apart, so the last few may take a few minutes to arrive.
            </span>
          </p>

          {error && <p role="alert" className="k-note is-risk mt-3">{error}</p>}
          {saving && (
            <p role="status" className="k-note is-warn mt-3">
              <span>Creating {rows.length} account{rows.length === 1 ? "" : "s"} and queuing the invitation emails. Keep this page open; a big batch can take a minute or two.</span>
            </p>
          )}

          <div className="mt-auto flex flex-col-reverse gap-2 pt-5">
            <Btn block variant="ghost" onClick={() => onBack()} disabled={saving}>Back to review</Btn>
            <Btn block variant="primary" type="submit" disabled={saving || activeCompanies.length === 0}>
              {saving ? `Creating ${rows.length} accounts…` : `Create ${rows.length} account${rows.length === 1 ? "" : "s"} & send invites`}
            </Btn>
          </div>
        </div>
      </Section>
    </form>
  );
}

function DoneStep({ result, onAnother }) {
  return (
    <section className="dash-card mx-auto max-w-lg text-center">
      <span className="mx-auto inline-flex text-emerald-600">
        <Icon name="check" size={36} />
      </span>
      <h2 className="mt-3 text-xl font-semibold text-slate-900">{result.created} intern{result.created === 1 ? "" : "s"} added</h2>
      <p className="mt-2 text-sm text-slate-600">
        Deployed to <span className="font-semibold text-slate-900">{result.company}</span>. Invitations are on their way —
        each intern sets their own password from the email, then they can log in.
      </p>
      {result.skipped > 0 && (
        <p className="mt-2 text-sm text-slate-600">
          {result.skipped} intern{result.skipped === 1 ? " was" : "s were"} already in Internova and left unchanged.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Btn variant="primary" href="/coordinator/interns">Go to Interns</Btn>
        <Btn onClick={onAnother}>Import another file</Btn>
      </div>
    </section>
  );
}

export default function ImportInterns() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null); // { fileName, skippedSample }
  const [rows, setRows] = useState([]);
  const [serverErrors, setServerErrors] = useState({});
  const [existingKeys, setExistingKeys] = useState(() => new Set());
  const [checking, setChecking] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [result, setResult] = useState(null);
  const checkRun = useRef(0);
  const courses = useSchoolCourses();

  useEffect(() => {
    fetchCoordinatorData("companies").then((r) => setCompanies(r.companies ?? [])).catch(() => setCompanies([]));
  }, []);

  // Server-side check (emails that already have an account), re-run shortly
  // after edits stop. Results are mapped from row position back to row key.
  const runServerCheck = useCallback((currentRows) => {
    const run = ++checkRun.current;
    setChecking(true);
    apiFetch("/api/coordinator/intern-imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: currentRows.map(({ key, ...r }) => r) }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (run !== checkRun.current) return;
        setExistingKeys(new Set((data.existing ?? []).map((index) => currentRows[index]?.key).filter(Boolean)));
        const mapped = {};
        for (const [index, fields] of Object.entries(data.errors ?? {})) {
          const row = currentRows[Number(index)];
          if (row) mapped[row.key] = fields;
        }
        setServerErrors(mapped);
      })
      .catch(() => {})
      .finally(() => { if (run === checkRun.current) setChecking(false); });
  }, []);

  useEffect(() => {
    if (step !== 2 || rows.length === 0) return;
    const timer = setTimeout(() => runServerCheck(rows), 600);
    return () => clearTimeout(timer);
  }, [rows, step, runServerCheck]);

  // Instant format checks win; the server's are shown where those pass.
  const errors = useMemo(() => {
    const client = validateRows(rows, courses.offered, courses.canonical);
    const merged = {};
    for (const row of rows) {
      if (existingKeys.has(row.key)) continue;
      const combined = { ...(serverErrors[row.key] ?? {}), ...(client[row.key] ?? {}) };
      if (Object.keys(combined).length) merged[row.key] = combined;
    }
    return merged;
  }, [rows, serverErrors, existingKeys, courses.offered, courses.canonical]);

  const newRows = useMemo(() => rows.filter((r) => !existingKeys.has(r.key)), [rows, existingKeys]);

  function reset() {
    setStep(1);
    setFile(null);
    setRows([]);
    setServerErrors({});
    setExistingKeys(new Set());
    setResult(null);
  }

  return (
    <Page>
      <PageHeader
        back={{ href: "/coordinator/interns", label: "Back to Interns" }}
        title="Import interns"
        sentence="Add a whole batch from your school's masterlist. Nothing is saved until the last step, and each intern gets an email to set their own password."
      />
      {step < 4 && <Stepper step={step} />}

      {step === 1 && (
        <UploadStep
          courses={courses}
          onLoaded={({ fileName, skippedSample, rows: loaded }) => {
            setFile({ fileName, skippedSample });
            setServerErrors({});
            setRows(loaded);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <ReviewStep
          fileName={file?.fileName}
          skippedSample={file?.skippedSample}
          rows={rows}
          setRows={setRows}
          errors={errors}
          existing={existingKeys}
          checking={checking}
          courses={courses}
          onBack={reset}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <DeployStep
          rows={newRows}
          companies={companies}
          courses={courses}
          onBack={(rowErrors) => {
            if (rowErrors) {
              // Something changed since the review (e.g. an account was created
              // elsewhere) — show the server's findings on the review table.
              const mapped = {};
              for (const [index, fields] of Object.entries(rowErrors)) {
                const row = newRows[Number(index)];
                if (row) mapped[row.key] = fields;
              }
              setServerErrors(mapped);
            }
            setStep(2);
          }}
          onImported={(res) => { setResult({ ...res, skipped: rows.length - newRows.length }); setStep(4); }}
        />
      )}

      {step === 4 && result && <DoneStep result={result} onAnother={reset} />}
    </Page>
  );
}
