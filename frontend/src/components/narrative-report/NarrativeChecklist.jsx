"use client";

// Requirements checklist for one intern's narrative report, built from the
// same payload the report itself renders (GET .../narrative-report), in the
// school template's section order. Shared by the intern's portfolio page and
// the coordinator's intern pages so both see the same status.

const titleCase = (title) => title.charAt(0) + title.slice(1).toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Returns { done, detail } for a section, or null for sections that need
// nothing from the intern (fixed text and blank pages are signed on paper).
function sectionStatus(section, report) {
  switch (section.source) {
    case "document": {
      const doc = report.documents?.[section.key];
      if (!doc) return { done: false, detail: "Not uploaded yet" };
      const pending = doc.status && doc.status !== "approved";
      return { done: true, detail: `${doc.file_name}${pending ? ` (${doc.status})` : ""}`, warn: pending };
    }
    case "intern_text": {
      const written = report.texts?.[section.key]?.trim();
      return { done: Boolean(written), detail: written ? "Written" : "Not written yet" };
    }
    case "auto_ledger": {
      const { total_hours: total = 0, required_hours: required } = report.ledger ?? {};
      return { done: required ? total >= required : total > 0, detail: `${total} of ${required ?? "—"} hours rendered` };
    }
    case "auto_attendance": {
      const n = report.attendance_photos?.length ?? 0;
      return { done: n > 0, detail: n ? plural(n, "attendance photo") : "No approved attendance yet" };
    }
    case "auto_duties": {
      const n = report.duties?.tasks?.length ?? 0;
      return { done: n > 0, detail: n ? plural(n, "assigned task") : "No tasks assigned yet" };
    }
    case "auto_photos": {
      const n = report.task_photos?.length ?? 0;
      return { done: n > 0, detail: n ? plural(n, "work photo") : "No task proof photos yet" };
    }
    case "auto_work_samples": {
      const n = report.work_samples?.length ?? 0;
      return { done: n > 0, detail: n ? plural(n, "portfolio item") : "No portfolio items yet" };
    }
    case "auto_journal": {
      const n = report.journal?.length ?? 0;
      return { done: n > 0, detail: n ? `${n} journal ${n === 1 ? "entry" : "entries"}` :"No approved activities yet" };
    }
    case "auto_evaluation": {
      const e = report.evaluation;
      return { done: Boolean(e), detail: e ? `${e.evaluation_type} evaluation · ${Number(e.overall_score)}%` : "No performance evaluation yet" };
    }
    default:
      return null;
  }
}

export default function NarrativeChecklist({ report, title = "Narrative report requirements" }) {
  const rows = (report?.template?.sections ?? [])
    .map((section) => ({ section, status: sectionStatus(section, report) }))
    .filter((r) => r.status);
  if (rows.length === 0) return null;
  const doneCount = rows.filter((r) => r.status.done).length;
  const percent = Math.round((doneCount / rows.length) * 100);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{doneCount}</span> of {rows.length} complete
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-blue-600"}`} style={{ width: `${percent}%` }} />
      </div>

      <ul className="mt-4 divide-y divide-slate-100 text-sm">
        {rows.map(({ section, status }) => (
          <li key={section.key} className="flex items-start gap-3 py-2">
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                !status.done ? "bg-amber-100 text-amber-700" : status.warn ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {status.done ? "✓" : "!"}
            </span>
            <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
              <p className="font-medium text-slate-800">{titleCase(section.title)}</p>
              <p className={`break-words sm:text-right ${status.done ? "text-slate-500" : "text-amber-700"}`}>{status.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
