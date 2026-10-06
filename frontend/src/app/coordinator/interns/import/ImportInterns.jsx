"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/apiFetch";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import CompanySupervisorsNote from "@/components/coordinator/CompanySupervisorsNote";
import { clean } from "@/lib/inputRules";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS, hoursForCourse, normalizeCourse } from "@/lib/internOptions";
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  cleanRow,
  downloadTemplate,
  isCustomCourse,
  readInternFile,
  validateRows,
} from "@/lib/internImport";

const STEPS = ["Upload file", "Review", "Deploy & invite"];

/** The corrected address out of a "Did you mean juan@gmail.com?" message. */
function suggestedEmail(message) {
  return message?.match(/Did you mean ([^\s?]+@[^\s?]+)\?/)?.[1] ?? null;
}

const cellBase =
  "w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white";
const cellOk = "border-transparent hover:border-slate-200";
const cellBad = "border-red-300 bg-red-50";

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
                state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {state === "done" ? <Icon name="check" size={14} /> : n}
            </span>
            {/* Phones show only the current step's name; numbers carry the rest. */}
            <span className={`text-sm font-medium ${state === "todo" ? "text-slate-400" : "text-slate-800"} ${state === "current" ? "" : "hidden sm:inline"}`}>{label}</span>
            {n < STEPS.length && <span className="mx-1 h-px w-6 bg-slate-200 sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

function UploadStep({ onLoaded }) {
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
      const result = await readInternFile(file);
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
      await downloadTemplate();
    } finally {
      setTemplateBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          disabled={reading}
          className={`flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-12 text-center transition sm:py-16 ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50"
          }`}
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
            <Icon name="upload" size={26} />
          </span>
          <span className="mt-4 text-base font-semibold text-slate-900">
            {reading ? "Reading your file…" : "Drop your masterlist here"}
          </span>
          <span className="mt-1 text-sm text-slate-500">
            or <span className="font-semibold text-blue-600">browse your files</span>
          </span>
          <span className="mt-3 text-xs text-slate-400">Excel (.xlsx) or CSV · up to {IMPORT_MAX_ROWS} interns</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
      </div>

      <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Prepare your file</h3>
        <p className="mt-1 text-sm text-slate-500">
          Start from the template, or upload the school&apos;s own masterlist — columns are matched by their headings.
        </p>
        <button
          type="button"
          onClick={handleTemplate}
          disabled={templateBusy}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
        >
          <Icon name="download" size={16} /> {templateBusy ? "Preparing…" : "Download template (.xlsx)"}
        </button>

        <dl className="mt-5 divide-y divide-slate-100 text-sm">
          {[
            ["First name", "Required"],
            ["Last name", "Required"],
            ["Email", "Required"],
            ["Course", "Required"],
            ["Year level", "Optional · 4th Year if blank"],
          ].map(([label, rule]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-2">
              <dt className="font-medium text-slate-700">{label}</dt>
              <dd className={`text-xs ${rule === "Required" ? "font-semibold text-slate-600" : "text-slate-400"}`}>{rule}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          Courses: {COURSE_OPTIONS.join(", ")} — or any other program name. A single &quot;Name&quot; column written as
          &quot;Dela Cruz, Juan&quot; works too.
        </p>
        <p className="mt-2 flex gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-800">
          <Icon name="user" size={14} className="mt-0.5 shrink-0" />
          No student numbers needed — each intern enters their own when they activate their account.
        </p>
      </aside>
    </div>
  );
}

function ReviewStep({ fileName, skippedSample, rows, setRows, errors, existing, checking, onBack, onContinue }) {
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
    setRows((prev) => prev.map((r) => (r.key === key ? { key: r.key, ...cleanRow(r) } : r)));
  }

  function remove(key) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const FIELD_RULES = { first_name: "personName", last_name: "personName", email: "email" };

  function renderField(row, field, position, rowErrors) {
    if (existing.has(row.key)) {
      return <p className="truncate px-2.5 py-1.5 text-sm text-slate-500">{row[field] || "—"}</p>;
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
            inputMode={field === "email" ? "email" : undefined}
            className={className}
          />
        )}
        {error && <p className="mt-1 px-1 text-[11px] leading-snug text-red-600">{error}</p>}
        {suggestedEmail(error) && (
          <button
            type="button"
            onClick={() => update(row.key, "email", suggestedEmail(error))}
            className="mt-0.5 px-1 text-[11px] font-semibold text-blue-600 hover:underline"
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
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <Icon name="file" size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{fileName}</p>
            <p className="text-xs text-slate-500">
              {rows.length} intern{rows.length === 1 ? "" : "s"} found{skippedSample ? " · example row skipped" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Icon name="check" size={12} /> {readyCount} new
          </span>
          {existingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600" title="Already in Internova — these are skipped">
              {existingCount} already added
            </span>
          )}
          {problemCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyProblems((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                onlyProblems ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"
              }`}
            >
              {problemCount} need{problemCount === 1 ? "s" : ""} fixing {onlyProblems ? "· show all" : "· show only these"}
            </button>
          )}
          {checking && <span className="text-xs text-slate-400">Checking against existing accounts…</span>}
        </div>
      </section>

      <datalist id="import-course-options">
        {COURSE_OPTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* Phones: one card per intern, every field labelled. */}
      <div className="space-y-3 sm:hidden">
        {visible.map((row) => {
          const rowErrors = errors[row.key] ?? {};
          const position = rows.indexOf(row) + 1;
          const hasErrors = Object.keys(rowErrors).length > 0;
          const isExisting = existing.has(row.key);
          return (
            <article key={row.key} className={`rounded-2xl border p-4 shadow-sm ${isExisting ? "border-slate-200 bg-slate-50" : hasErrors ? "border-red-200 bg-white" : "border-slate-200 bg-white"}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                  Intern {position}
                  {isExisting && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Already added</span>}
                </span>
                <button type="button" onClick={() => remove(row.key)} aria-label={`Remove row ${position}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Icon name="trash" size={15} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field} className={field === "email" ? "col-span-2 block" : "block"}>
                    <span className="mb-0.5 block px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{FIELD_LABELS[field]}</span>
                    {renderField(row, field, position, rowErrors)}
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {/* Larger screens: an editable table. */}
      <section className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-12" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[31%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-14" />
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 text-center">#</th>
                {IMPORT_FIELDS.map((f) => <th key={f} className="px-2 py-3">{FIELD_LABELS[f]}</th>)}
                <th className="px-2 py-3"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => {
                const rowErrors = errors[row.key] ?? {};
                const position = rows.indexOf(row) + 1;
                return (
                  <tr key={row.key} className={existing.has(row.key) ? "bg-slate-50" : Object.keys(rowErrors).length ? "bg-red-50/40" : ""}>
                    <td className="px-3 py-3.5 text-center align-top text-xs font-medium text-slate-400">
                      {position}
                      {existing.has(row.key) && <span className="mt-1 block text-[10px] font-semibold leading-tight text-slate-500">Already added</span>}
                    </td>
                    {IMPORT_FIELDS.map((field) => (
                      <td key={field} className="px-1.5 py-2 align-top">{renderField(row, field, position, rowErrors)}</td>
                    ))}
                    <td className="px-2 py-2.5 align-top">
                      <button
                        type="button"
                        onClick={() => remove(row.key)}
                        aria-label={`Remove row ${position}`}
                        title="Remove this intern"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
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
        <p className="rounded-3xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">Every row was removed. Upload the file again to start over.</p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Upload a different file
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {problemCount > 0 && (
            <button type="button" onClick={removeProblems} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
              Remove {problemCount} row{problemCount === 1 ? "" : "s"} with problems
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={problemCount > 0 || newCount === 0 || checking}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue with {newCount} new intern{newCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
      {problemCount > 0 ? (
        <p className="text-right text-xs text-slate-500">Fix the highlighted cells or remove those rows to continue.</p>
      ) : newCount === 0 && existingCount > 0 ? (
        <p className="text-right text-xs text-slate-500">Everyone in this file is already in Internova — add new names to the list to import them.</p>
      ) : null}
    </div>
  );
}

function DeployStep({ rows, companies, onBack, onImported }) {
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

  const selectClass = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50";

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Where are they deployed?</h3>
        <p className="mt-1 text-sm text-slate-500">Applies to everyone in this batch. Import another file for interns going to a different company.</p>

        {activeCompanies.length === 0 ? (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You don&apos;t have an active partner company yet. <Link href="/coordinator/companies" className="font-semibold underline">Add one</Link> first, then come back.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Company</span>
              <select value={form.company_id} onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))} className={selectClass}>
                <option value="">Select a company…</option>
                {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </label>
            <CompanySupervisorsNote companyId={form.company_id} companyName={activeCompanies.find((c) => String(c.id) === String(form.company_id))?.company_name} />
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Start date</span>
              <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className={selectClass} />
            </label>
          </div>
        )}
      </section>

      <aside className="flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Summary</h3>
        <p className="mt-3 text-3xl font-bold text-slate-900">{rows.length}</p>
        <p className="text-sm text-slate-500">intern account{rows.length === 1 ? "" : "s"} to create</p>

        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {byCourse.map(([course, count]) => (
            <li key={course} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-slate-700">
                {course}
                {isCustomCourse(course) && <span className="ml-1.5 text-xs text-slate-400">(other program)</span>}
              </span>
              <span className="shrink-0 text-xs text-slate-500">{count} · {hoursForCourse(normalizeCourse(course))} h each</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-800">
          <Icon name="mail" size={14} className="mt-0.5 shrink-0" />
          Each intern gets an email to set their own password. Emails go out a second apart, so the last few may take a few minutes to arrive.
        </p>

        {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        <div className="mt-auto flex flex-col gap-2 pt-5">
          <button
            type="submit"
            disabled={saving || activeCompanies.length === 0}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? `Creating ${rows.length} accounts…` : `Create ${rows.length} account${rows.length === 1 ? "" : "s"} & send invites`}
          </button>
          <button type="button" onClick={() => onBack()} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Back to review
          </button>
        </div>
      </aside>
    </form>
  );
}

function DoneStep({ result, onAnother }) {
  return (
    <section className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <Icon name="check" size={30} />
      </span>
      <h2 className="mt-5 text-2xl font-semibold text-slate-900">{result.created} intern{result.created === 1 ? "" : "s"} added</h2>
      <p className="mt-2 text-sm text-slate-600">
        Deployed to <span className="font-semibold text-slate-800">{result.company}</span>. Invitations are on their way —
        each intern sets their own password from the email, then they can log in.
      </p>
      {result.skipped > 0 && (
        <p className="mt-2 text-sm text-slate-500">
          {result.skipped} intern{result.skipped === 1 ? " was" : "s were"} already in Internova and left unchanged.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/coordinator/interns" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Go to Interns
        </Link>
        <button type="button" onClick={onAnother} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Import another file
        </button>
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
    const client = validateRows(rows);
    const merged = {};
    for (const row of rows) {
      if (existingKeys.has(row.key)) continue;
      const combined = { ...(serverErrors[row.key] ?? {}), ...(client[row.key] ?? {}) };
      if (Object.keys(combined).length) merged[row.key] = combined;
    }
    return merged;
  }, [rows, serverErrors, existingKeys]);

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
    <div className="space-y-6">
      <div>
        <Link href="/coordinator/interns" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
          ← Back to Interns
        </Link>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Import interns</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Add a whole batch from your school&apos;s masterlist. Nothing is saved until the last step, and each intern gets an email to set their own password.
        </p>
        {step < 4 && <div className="mt-4"><Stepper step={step} /></div>}
      </div>

      {step === 1 && (
        <UploadStep
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
          onBack={reset}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <DeployStep
          rows={newRows}
          companies={companies}
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
    </div>
  );
}
