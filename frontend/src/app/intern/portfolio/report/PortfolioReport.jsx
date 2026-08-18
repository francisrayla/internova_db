"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/lib/UserContext";
import { fetchInternData } from "@/lib/internApi";

function StatBlock({ label, value }) {
  return (
    <div className="border-t border-slate-300 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function PortfolioReport() {
  const { user } = useCurrentUser();
  const [portfolio, setPortfolio] = useState(null);
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchInternData("portfolio"), fetchInternData("profile-summary"), fetchInternData("activities")])
      .then(([p, s, a]) => {
        setPortfolio(p.portfolio);
        setSummary(s);
        setActivities((a.activities ?? []).slice().reverse());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Preparing report…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between print:hidden">
        <Link href="/intern/portfolio" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Portfolio</Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">On-the-Job Training Portfolio Report</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{user?.name ?? "Intern"}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {user?.school_name ?? "—"}
            {summary?.company_name ? ` · ${summary.company_name}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-400">Generated on {generatedOn}</p>
        </header>

        {summary?.has_deployment && (
          <section className="grid grid-cols-3 gap-6 py-6">
            <StatBlock label="Hours Rendered" value={`${summary.hours_completed}h / ${summary.required_hours}h`} />
            <StatBlock label="Tasks Completed" value={`${summary.tasks_completed} / ${summary.tasks_total}`} />
            <StatBlock label="Latest Evaluation" value={summary.latest_evaluation_score != null ? `${summary.latest_evaluation_score}%` : "—"} />
          </section>
        )}

        <section className="border-t border-slate-200 py-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">About</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            {portfolio?.bio || "No bio written yet."}
          </p>
        </section>

        <section className="border-t border-slate-200 py-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Daily Narrative Report</h2>
          {activities.length === 0 ? (
            <p className="text-sm text-slate-400">No daily entries logged yet.</p>
          ) : (
            <div className="space-y-5">
              {activities.map((a) => (
                <div key={a.id} className="flex gap-4 break-inside-avoid border-b border-dashed border-slate-200 pb-5 last:border-b-0 last:pb-0">
                  {a.photo_url && (
                    <img src={a.photo_url} alt="" className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{a.activity_date}</p>
                      {a.hours_rendered > 0 && (
                        <p className="text-xs font-medium text-slate-500">{a.hours_rendered}h rendered</p>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800">{a.title}</p>
                    {a.description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-slate-200 py-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Work Samples</h2>
          {(portfolio?.items?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">No work samples added yet.</p>
          ) : (
            <div className="space-y-6">
              {portfolio.items.map((item) => (
                <div key={item.id} className="flex gap-4 break-inside-avoid">
                  {item.image_url && (
                    <img src={item.image_url} alt="" className="h-24 w-24 shrink-0 rounded-xl border border-slate-200 object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    {item.description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>}
                    {item.project_url && (
                      <a href={item.project_url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs font-medium text-blue-600 hover:underline print:text-slate-500">
                        {item.project_url}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-slate-200 pt-4 text-center text-[10px] text-slate-400">
          Generated by Internova AI — {user?.school_name ?? "Internova AI"}
        </footer>
      </article>
    </div>
  );
}
