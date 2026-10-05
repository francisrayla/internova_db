"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchApiData } from "@/lib/apiFetch";
import Icon from "@/components/Icon";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/dean/ui";

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
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        What your coordinator still needs to do, oldest first.
        {data.stale_count > 0 && <> <span className="font-semibold text-amber-700">{data.stale_count} {data.stale_count === 1 ? "item has" : "items have"} been waiting more than {data.stale_threshold_days} days.</span></>}
      </p>
      <ul className="space-y-2">
        {data.items.map((item, i) => {
          const meta = TYPE[item.type] ?? { icon: "list", label: "To do" };
          const body = (
            <>
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.stale ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                <Icon name={meta.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                <span className={`block text-sm ${item.stale ? "font-medium text-amber-700" : "text-slate-500"}`}>{item.detail}</span>
              </span>
              <Pill tone={item.stale ? "amber" : "slate"}>{meta.label}</Pill>
            </>
          );
          const cls = `flex items-start gap-3 rounded-2xl border bg-white p-4 ${item.stale ? "border-amber-200" : "border-slate-200"}`;
          return (
            <li key={`${item.type}-${i}`}>
              {item.link ? <Link href={item.link} className={`${cls} transition hover:border-blue-300`}>{body}</Link> : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
