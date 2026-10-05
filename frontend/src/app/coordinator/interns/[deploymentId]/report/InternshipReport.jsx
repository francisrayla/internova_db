"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";

function StatBlock({ label, value }) {
  return (
    <div className="border-t border-slate-300 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function InternshipReport() {
  const { deploymentId } = useParams();
  const [report, setReport] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchCoordinatorData(`interns/${deploymentId}/report`)
      .then((r) => setReport(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    fetchCoordinatorData(`interns/${deploymentId}/narrative-report`)
      .then(setNarrative)
      .catch(() => setNarrative(null));
  }, [deploymentId]);

  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Preparing report…</p>;
  }

  if (error || !report) {
    return (
      <div className="space-y-4">
        <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Interns</Link>
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Report not found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between print:hidden">
        <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Interns</Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Print / Save as PDF
        </button>
      </div>

      {narrative && (
        <div className="mb-5 space-y-2 print:hidden">
          <NarrativeChecklist report={narrative} />
          <Link href={`/coordinator/interns/${deploymentId}/narrative-report`} className="inline-block text-sm font-semibold text-blue-600 hover:underline">
            Open narrative report →
          </Link>
        </div>
      )}

      <article className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Internship Progress Report</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{report.intern.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {report.intern.student_number ? `${report.intern.student_number} · ` : ""}
            {report.intern.course ?? "—"}{report.intern.year_level ? `, ${report.intern.year_level}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {report.school_name ?? "—"}
            {report.company.name ? ` · Deployed at ${report.company.name}` : ""}
            {report.supervisor_name ? ` · Supervisor: ${report.supervisor_name}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {report.deployment.start_date ?? "—"} – {report.deployment.end_date ?? "Present"} · Generated on {generatedOn}
          </p>
        </header>

        <section className="grid grid-cols-3 gap-6 py-6">
          <StatBlock label="Hours Rendered" value={`${report.summary.hours_completed}h / ${report.summary.required_hours}h`} />
          <StatBlock label="Tasks Completed" value={`${report.summary.tasks_completed} / ${report.summary.tasks_total}`} />
          <StatBlock label="Latest Evaluation" value={report.summary.latest_evaluation_score != null ? `${report.summary.latest_evaluation_score}%` : "—"} />
        </section>

        <section className="border-t border-slate-200 py-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Attendance Standing</h2>
          <div className="flex gap-8 text-sm text-slate-700">
            <p><span className="font-semibold text-slate-900">{report.attendance_summary.approved_days}</span> approved day{report.attendance_summary.approved_days === 1 ? "" : "s"}</p>
            <p><span className="font-semibold text-slate-900">{report.attendance_summary.pending_days}</span> pending review</p>
            <p><span className="font-semibold text-slate-900">{report.attendance_summary.rejected_days}</span> rejected</p>
          </div>
        </section>

        <section className="border-t border-slate-200 py-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Evaluations</h2>
          {report.evaluations.length === 0 ? (
            <p className="text-sm text-slate-400">No evaluations submitted yet.</p>
          ) : (
            <div className="space-y-6">
              {report.evaluations.map((e) => (
                <div key={e.id} className="break-inside-avoid rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-slate-900">{e.evaluation_date} · {e.evaluation_type ?? "Evaluation"}</p>
                    <p className="text-sm font-semibold text-blue-700">{e.overall_score}%</p>
                  </div>
                  <p className="text-xs text-slate-500">Evaluated by {e.evaluator_name ?? "—"}</p>
                  <div className="mt-3 space-y-1.5">
                    {e.scores.map((s) => (
                      <div key={s.criteria_id} className="flex items-center justify-between text-xs text-slate-600">
                        <span>{s.criterion_name}</span>
                        <span className="font-medium text-slate-900">{s.score} / {s.max_score}</span>
                      </div>
                    ))}
                  </div>
                  {e.remarks && <p className="mt-3 text-sm leading-relaxed text-slate-700">{e.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-slate-200 pt-4 text-center text-[10px] text-slate-400">
          Generated by Internova — {report.school_name ?? "Internova"}
        </footer>
      </article>
    </div>
  );
}
