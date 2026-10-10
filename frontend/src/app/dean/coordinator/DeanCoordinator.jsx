"use client";

import { useCallback, useEffect, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import { useUrlTab } from "@/lib/useUrlTab";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import { Avatar, EmptyState, ErrorNote, Pill, Skeleton, TabBar } from "@/components/dean/ui";
import { Btn, Page, PageHeader } from "@/components/dash/page";
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
    <Page>
      <PageHeader
        title="Coordinator"
        sentence="See what your coordinator has been doing, what is still waiting on them, and send them feedback."
      >
        {c && (
          <Btn href={MANAGE_HREF} variant="secondary">
            <NavIcon name="settings" size={16} /> Manage coordinator
          </Btn>
        )}
      </PageHeader>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your coordinator.</ErrorNote>}
      {profile === undefined && !error && <Skeleton className="h-24" />}

      {profile !== undefined && !c && (
        <EmptyState
          icon="user"
          title="No coordinator yet"
          text="Invite a coordinator so someone can add partner companies, supervisors and interns. Their work will show up here."
          action={<Btn href={MANAGE_HREF} variant="primary">Invite a coordinator</Btn>}
        />
      )}

      {c && (
        <>
          <section className="dash-card">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={c.name} url={c.avatar_url} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 truncate text-base font-semibold text-slate-900">{c.name}</p>
                  <Pill tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label}</Pill>
                </div>
                <p className="truncate text-sm text-slate-600">{c.email}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {c.status === "active" && <>Last active {c.last_active_at ? timeAgo(c.last_active_at) : "never"} · </>}
                  Member since {formatDate(c.member_since)}
                </p>
              </div>
            </div>
          </section>

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
    </Page>
  );
}
