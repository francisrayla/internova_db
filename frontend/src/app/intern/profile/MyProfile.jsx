"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera, Pencil } from "lucide-react";
import NavIcon from "@/components/NavIcon";
import { Avatar, Btn, DataList, EmptyState, KeyValueList, Page, PageHeader, Section, SkeletonList } from "@/components/dash/page";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import EditProfileModal from "@/components/EditProfileModal";
import { useCurrentUser } from "@/lib/UserContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";
import DeploymentHistory from "@/components/DeploymentHistory";

const LIVE_TYPES = [
  "task_evaluated",
  "task_comment",
  "attendance_reviewed",
  "evaluation_submitted",
  "evaluation_updated",
  "activity_reviewed",
];

export default function MyProfile() {
  const { user, onUserUpdated } = useCurrentUser();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  function load() {
    fetchInternData("profile-summary")
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useLiveRefresh(LIVE_TYPES, load);

  const details = [
    { label: "Email", value: user?.email ?? "—" },
    ...(user?.phone ? [{ label: "Phone", value: user.phone }] : []),
    { label: "School", value: user?.school_name ?? "—" },
    { label: "Company", value: summary?.company_name ?? "—" },
    { label: "Supervisor", value: summary?.supervisor_name ?? "—" },
  ];

  return (
    <Page size="narrow">
      <PageHeader title="My profile" sentence="Your details and how your internship is going." />

      <Section>
        <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap sm:gap-5">
          <Avatar name={user?.name ?? "Intern"} url={user?.avatar_url} size={72} tone="self" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">{user?.name ?? "Intern"}</h2>
            <p className="truncate text-sm text-slate-600">{user?.email ?? "—"}</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
            <Btn onClick={() => setShowAvatarModal(true)} className="max-sm:flex-1">
              <Camera size={15} aria-hidden="true" /> Change photo
            </Btn>
            <Btn onClick={() => setShowEditModal(true)} className="max-sm:flex-1">
              <Pencil size={15} aria-hidden="true" /> Edit profile
            </Btn>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-200 pt-4">
          <KeyValueList items={details} />
        </div>
      </Section>

      <DeploymentHistory history={summary?.history} compact title="Where you have trained" />

      {loading ? (
        <SkeletonList rows={2} height="h-20" />
      ) : !summary?.has_deployment ? (
        <EmptyState icon="interns" title="Not deployed yet" text="Once your coordinator sets up your company, your progress will show up here." />
      ) : (
        <Section flush title="Your progress">
          <DataList>
            {[
              {
                href: "/intern/attendance",
                title: "Hours rendered",
                value: `${summary.hours_completed}h / ${summary.required_hours}h`,
                sub: `${Math.max(0, summary.required_hours - summary.hours_completed).toFixed(1)}h left`,
                pct: summary.hours_progress_pct,
              },
              {
                href: "/intern/tasks",
                title: "Tasks",
                value: `${summary.tasks_completed} / ${summary.tasks_total} done`,
                sub: summary.tasks_total > 0 ? `${summary.task_progress_pct}% complete` : "No tasks assigned yet",
                pct: summary.tasks_total > 0 ? summary.task_progress_pct : undefined,
              },
              {
                href: "/intern/activities",
                title: "Narrative report",
                value: summary.has_activity_today ? "Logged today" : "Not logged today",
                sub: summary.last_activity_date ? `Last entry: ${summary.last_activity_date}` : "No entries yet",
              },
              {
                href: "/intern/evaluations",
                title: "Evaluations",
                value: `${summary.evaluations_count} received`,
                sub: summary.latest_evaluation_score != null ? `Latest score: ${summary.latest_evaluation_score}` : "No evaluations yet",
              },
            ].map((row) => (
              <li key={row.href}>
                <Link href={row.href} className="k-row">
                  <span className="k-row-main">
                    <span className="k-row-title">{row.title}</span>
                    <span className="k-row-sub">{row.sub}</span>
                    {typeof row.pct === "number" && (
                      <span className="k-bar mt-2 block"><span style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }} /></span>
                    )}
                  </span>
                  <span className="k-row-side">
                    <span className="text-right font-semibold text-slate-900">{row.value}</span>
                    <NavIcon name="arrow" size={14} className="shrink-0 text-slate-500" />
                  </span>
                </Link>
              </li>
            ))}
          </DataList>
        </Section>
      )}

      {showAvatarModal && (
        <AvatarUploadModal user={user} onClose={() => setShowAvatarModal(false)} onUpdated={onUserUpdated} />
      )}
      {showEditModal && (
        <EditProfileModal user={user} onClose={() => setShowEditModal(false)} onUpdated={onUserUpdated} />
      )}
    </Page>
  );
}
