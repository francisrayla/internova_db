"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import NavIcon from "@/components/NavIcon";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/dean/ui";
import { DataList, DataRow, Section } from "@/components/dash/page";

const TYPE = {
  document_review: { icon: "file", label: "Document review" },
  invitation: { icon: "mail", label: "Invitation" },
  no_supervisor: { icon: "user", label: "Supervisor" },
  evaluation_due: { icon: "check", label: "Evaluation" },
  close_deployment: { icon: "calendar", label: "Deployment" },
  narrative_template: { icon: "file", label: "Report setup" },
};

export default function PendingTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/pending").then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorNote onRetry={load}>We couldn&apos;t load the pending work.</ErrorNote>;
  if (!data) return <SkeletonList rows={4} height="h-16" />;

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Nothing is waiting on your coordinator"
        text="Documents to review, unanswered invitations, interns without a supervisor and missing evaluations would be listed here, oldest first."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        What your coordinator still needs to do, oldest first.
        {data.stale_count > 0 && <> <span className="font-semibold text-amber-700">{data.stale_count} {data.stale_count === 1 ? "item has" : "items have"} been waiting more than {data.stale_threshold_days} days.</span></>}
      </p>
      <Section flush>
        <DataList>
          {data.items.map((item, i) => {
            const meta = TYPE[item.type] ?? { icon: "list", label: "To do" };
            return (
              <DataRow
                key={`${item.type}-${i}`}
                href={item.link || undefined}
                wrap
                lead={<span className={`shrink-0 self-start pt-0.5 ${item.stale ? "text-amber-700" : "text-slate-500"}`}><NavIcon name={meta.icon} size={18} /></span>}
                title={item.title}
                sub={<span className={item.stale ? "font-medium text-amber-700" : undefined}>{item.detail}</span>}
                side={<Pill tone={item.stale ? "amber" : "slate"}>{meta.label}</Pill>}
              />
            );
          })}
        </DataList>
      </Section>
    </div>
  );
}
