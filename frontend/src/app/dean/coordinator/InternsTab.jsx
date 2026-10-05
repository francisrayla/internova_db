"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchApiData } from "@/lib/apiFetch";
import InternCard from "@/components/dean/InternCard";
import { EmptyState, ErrorNote, SkeletonList } from "@/components/dean/ui";

export default function InternsTab() {
  const [interns, setInterns] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "interns").then((d) => { setInterns(d.interns); setError(false); }).catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorNote onRetry={load}>We couldn&apos;t load the interns.</ErrorNote>;
  if (!interns) return <SkeletonList rows={3} height="h-32" />;
  if (interns.length === 0) {
    return <EmptyState icon="users" title="No interns yet" text="Interns your coordinator adds will appear here with their hours and narrative report progress." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">The interns your coordinator handles. Tap one for the full picture.</p>
        <Link href="/dean/interns" className="text-sm font-semibold text-blue-700 hover:underline">Open the Interns page →</Link>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {interns.map((i) => <InternCard key={i.deployment_id} intern={i} />)}
      </div>
    </div>
  );
}
