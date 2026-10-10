"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { EmptyState, Page, PageHeader, Pill, Section, SkeletonList, TableWrap } from "@/components/dash/page";

export default function AIUsagePage() {
  const [schools, setSchools] = useState([]);
  const [summary, setSummary] = useState({ entitled_schools: 0, polished_count: 0, drafted_count: 0, failed_count: 0, feature_live: false, model: null, period_label: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSuperadminData("ai-usage")
      .then((r) => {
        setSchools(r.schools ?? []);
        setSummary({
          entitled_schools: r.entitled_schools ?? 0,
          polished_count: r.polished_count ?? 0,
          drafted_count: r.drafted_count ?? 0,
          failed_count: r.failed_count ?? 0,
          feature_live: Boolean(r.feature_live),
          model: r.model ?? null,
          period_label: r.period_label ?? "",
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const figures = [
    ["Entitled schools", summary.entitled_schools, "On a plan that includes AI"],
    ["Narratives polished", summary.polished_count, summary.period_label || "This month"],
    ["Narratives auto-drafted", summary.drafted_count, summary.period_label || "This month"],
    ["Failed requests", summary.failed_count, "Fell back to saving as written"],
  ];

  return (
    <Page>
      <PageHeader
        title="AI Usage"
        sentence="AI writing help for intern narratives — polishing what interns write, and drafting entries for days they attended but didn't log. Included in the Premium plan."
      />

      {!loading && (summary.feature_live ? (
        <div className="k-note is-ok">
          <span className="min-w-0">
            <strong className="block">AI is live</strong>
            Running on Google Gemini ({summary.model}). If the AI is ever unavailable, interns can still save their narratives as written.
          </span>
        </div>
      ) : (
        <div className="k-note is-warn">
          <span className="min-w-0">
            <strong className="block">AI isn&apos;t set up on the server</strong>
            Add a GEMINI_API_KEY to the backend and queue services to turn it on. Until then, interns save narratives as written
            and missed days get a plain template entry.
          </span>
        </div>
      ))}

      <div className="dash-strip" style={{ "--cols": figures.length }}>
        {figures.map(([label, value, note]) => (
          <div key={label} className="dash-fig">
            <span className="dash-fig-label">{label}</span>
            <span className="dash-fig-value">{loading ? "—" : value}</span>
            <span className="dash-fig-note">{note}</span>
          </div>
        ))}
      </div>

      <Section title="Schools" help="AI entitlement and this month's use, per school." flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-14" /></div>
        ) : schools.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="ai" title="No schools yet." text="Usage per school shows up here once a school is on a plan." />
          </div>
        ) : (
          <TableWrap>
            <table className="k-table is-hover is-stack">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Plan</th>
                  <th>AI Entitlement</th>
                  <th className="is-num">Polished</th>
                  <th className="is-num">Auto-drafted</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id}>
                    <td className="is-title">{s.school_name}</td>
                    <td data-label="Plan">{s.plan ?? "—"}</td>
                    <td data-label="AI Entitlement">
                      <Pill tone={s.ai_entitled ? "green" : "slate"}>{s.ai_entitled ? "Included in plan" : "Not on this plan"}</Pill>
                    </td>
                    <td className="is-num" data-label="Polished">{s.polished_count}</td>
                    <td className="is-num" data-label="Auto-drafted">{s.drafted_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </Page>
  );
}
