"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import { Avatar, ErrorNote, Pill, Skeleton, TabBar } from "@/components/dean/ui";
import ActivityTab from "./ActivityTab";
import PendingTab from "./PendingTab";
import InternsTab from "./InternsTab";
import FeedbackTab from "./FeedbackTab";
import ManageTab from "./ManageTab";

const STATUS = {
  pending: { label: "Invitation pending", tone: "amber" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Deactivated", tone: "slate" },
};

const TAB_KEYS = ["activity", "pending", "interns", "feedback", "manage"];

export default function DeanCoordinator() {
  const params = useSearchParams();
  const requested = params.get("tab");
  const [tab, setTab] = useState(TAB_KEYS.includes(requested) ? requested : "activity");
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/profile")
      .then((d) => { setProfile(d); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const c = profile?.coordinator;
  // With no coordinator at all there is nothing to monitor, so show Manage to invite someone.
  const activeTab = profile && !c ? "manage" : tab;

  const tabs = [
    { key: "activity", label: "Activity" },
    { key: "pending", label: "Pending work", count: c?.pending_count ?? 0, alert: true },
    { key: "interns", label: "Interns they handle" },
    { key: "feedback", label: "Feedback", count: profile?.unseen_feedback ?? 0 },
    { key: "manage", label: "Manage" },
  ];

  return (
    <div className="space-y-6 sm:p-2 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Coordinator</h1>
        <p className="mt-1 text-slate-600">
          See what your coordinator has been doing, what is still waiting on them, and send them feedback.
        </p>
      </div>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your coordinator.</ErrorNote>}
      {profile === undefined && !error && <Skeleton className="h-24" />}

      {profile !== undefined && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          {c ? (
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={c.name} url={c.avatar_url} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-lg font-semibold text-slate-900">{c.name}</p>
                  <Pill tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label}</Pill>
                </div>
                <p className="truncate text-sm text-slate-500">{c.email}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.status === "active" && <>Last active {c.last_active_at ? timeAgo(c.last_active_at) : "never"} · </>}
                  Member since {formatDate(c.member_since)}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-slate-900">No coordinator yet</p>
              <p className="text-sm text-slate-500">Invite one from the Manage tab so someone can add companies, supervisors and interns.</p>
            </div>
          )}
        </div>
      )}

      {profile !== undefined && (
        <>
          {c && <TabBar tabs={tabs} active={activeTab} onChange={setTab} />}
          <div>
            {activeTab === "activity" && <ActivityTab coordinator={c} />}
            {activeTab === "pending" && <PendingTab />}
            {activeTab === "interns" && <InternsTab />}
            {activeTab === "feedback" && <FeedbackTab coordinator={c} onSent={load} />}
            {activeTab === "manage" && <ManageTab coordinator={c} onChanged={load} />}
          </div>
        </>
      )}
    </div>
  );
}
