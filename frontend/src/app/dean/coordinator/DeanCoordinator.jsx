"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import { useUrlTab } from "@/lib/useUrlTab";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import Icon from "@/components/Icon";
import { Avatar, EmptyState, ErrorNote, Pill, Skeleton, TabBar } from "@/components/dean/ui";
import ActivityTab from "./ActivityTab";
import PendingTab from "./PendingTab";
import InternsTab from "./InternsTab";
import FeedbackTab from "./FeedbackTab";
import Insights from "./Insights";

const STATUS = {
  pending: { label: "Invitation pending", tone: "amber" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Deactivated", tone: "slate" },
};

const TAB_KEYS = ["summary", "activity", "pending", "interns", "feedback"];
const MANAGE_HREF = "/dean/coordinator/manage";

/** Read-only monitoring of the school's coordinator; actions live on /dean/coordinator/manage. */
export default function DeanCoordinator() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useUrlTab(TAB_KEYS, "summary");
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [error, setError] = useState(false);

  // Old links (alerts, bookmarks) used ?tab=manage before Manage had its own page.
  const legacyManage = params.get("tab") === "manage";
  useEffect(() => {
    if (legacyManage) router.replace(MANAGE_HREF);
  }, [legacyManage, router]);

  const load = useCallback(() => {
    fetchApiData("dean", "coordinator/profile")
      .then((d) => { setProfile(d); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const c = profile?.coordinator;

  const tabs = [
    { key: "summary", label: "Summary" },
    { key: "activity", label: "Activity" },
    { key: "pending", label: "Pending work", count: c?.pending_count ?? 0, alert: true },
    { key: "interns", label: "Interns they handle" },
    { key: "feedback", label: "Feedback", count: profile?.unread_replies ?? 0 },
  ];

  if (legacyManage) return null;

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

      {profile !== undefined && !c && (
        <EmptyState
          icon="user"
          title="No coordinator yet"
          text="Invite a coordinator so someone can add partner companies, supervisors and interns. Their work will show up here."
          action={<Link href={MANAGE_HREF} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Invite a coordinator</Link>}
        />
      )}

      {c && (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Avatar name={c.name} url={c.avatar_url} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-base font-semibold text-slate-900">{c.name}</p>
                  <Pill tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label}</Pill>
                </div>
                <p className="truncate text-sm text-slate-500">{c.email}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.status === "active" && <>Last active {c.last_active_at ? timeAgo(c.last_active_at) : "never"} · </>}
                  Member since {formatDate(c.member_since)}
                </p>
              </div>
            </div>
            <Link
              href={MANAGE_HREF}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Icon name="gear" size={16} /> Manage coordinator
            </Link>
          </div>

          <TabBar tabs={tabs} active={tab} onChange={setTab} />
          <div>
            {tab === "summary" && <Insights />}
            {tab === "activity" && <ActivityTab coordinator={c} />}
            {tab === "pending" && <PendingTab />}
            {tab === "interns" && <InternsTab />}
            {tab === "feedback" && <FeedbackTab coordinator={c} onSent={load} />}
          </div>
        </>
      )}
    </div>
  );
}
