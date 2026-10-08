"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import EditProfileModal from "@/components/EditProfileModal";
import { useCurrentUser } from "@/lib/UserContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";
import DeploymentHistory from "@/components/DeploymentHistory";
import { initialsOf } from "@/lib/format";

const LIVE_TYPES = [
  "task_evaluated",
  "task_comment",
  "attendance_reviewed",
  "evaluation_submitted",
  "evaluation_updated",
  "activity_reviewed",
];

function ProgressBar({ pct, tone = "bg-blue-600" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

// A "konting viewing" widget — enough of a glance to matter, the rest lives
// one tap away on the section it summarizes (task/attendance/narrative/
// evaluation history), same touchable-card pattern across the whole screen.
function SummaryCard({ href, icon, tone, label, value, sub, pct }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition sm:p-5 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}>
          <Icon name={icon} size={18} className="text-white" />
        </span>
        <Icon name="arrow" size={16} className="mt-2 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {typeof pct === "number" && <ProgressBar pct={pct} />}
    </Link>
  );
}

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

  const initials = initialsOf(user?.name);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap sm:gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-600 text-2xl font-semibold text-white ring-4 ring-blue-50">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">My Profile</p>
            <h1 className="mt-1 truncate text-xl font-semibold text-slate-900">{user?.name ?? "Intern"}</h1>
            <p className="truncate text-sm text-slate-500">{user?.email ?? "—"}</p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:shrink-0 sm:flex-col">
            <button
              type="button"
              onClick={() => setShowAvatarModal(true)}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 px-3 py-2 sm:flex-none sm:justify-start sm:px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Icon name="camera" size={15} /> Change photo
            </button>
            <button
              type="button"
              onClick={() => setShowEditModal(true)}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 px-3 py-2 sm:flex-none sm:justify-start sm:px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Icon name="edit" size={15} /> Edit profile
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
          {user?.phone && (
            <div>
              <p className="text-slate-500">Phone</p>
              <p className="font-semibold text-slate-900">{user.phone}</p>
            </div>
          )}
          <div>
            <p className="text-slate-500">School</p>
            <p className="font-semibold text-slate-900">{user?.school_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Company</p>
            <p className="font-semibold text-slate-900">{summary?.company_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Supervisor</p>
            <p className="font-semibold text-slate-900">{summary?.supervisor_name ?? "—"}</p>
          </div>
        <DeploymentHistory history={summary?.history} compact title="Where you have trained" className="mt-4 border-slate-100 shadow-none" />
        </div>
      </section>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          ))}
        </div>
      ) : !summary?.has_deployment ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">You&apos;re not deployed to a company yet — once your coordinator sets that up, your progress will show up here.</p>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <SummaryCard
            href="/intern/attendance"
            icon="calendar"
            tone="bg-blue-600"
            label="Hours rendered"
            value={`${summary.hours_completed}h / ${summary.required_hours}h`}
            sub={`${Math.max(0, summary.required_hours - summary.hours_completed).toFixed(1)}h left`}
            pct={summary.hours_progress_pct}
          />
          <SummaryCard
            href="/intern/tasks"
            icon="check"
            tone="bg-emerald-600"
            label="Tasks"
            value={`${summary.tasks_completed} / ${summary.tasks_total} done`}
            sub={summary.tasks_total > 0 ? `${summary.task_progress_pct}% complete` : "No tasks assigned yet"}
            pct={summary.tasks_total > 0 ? summary.task_progress_pct : undefined}
          />
          <SummaryCard
            href="/intern/activities"
            icon="file"
            tone="bg-orange-500"
            label="Narrative report"
            value={summary.has_activity_today ? "Logged today" : "Not logged today"}
            sub={summary.last_activity_date ? `Last entry: ${summary.last_activity_date}` : "No entries yet"}
          />
          <SummaryCard
            href="/intern/evaluations"
            icon="spark"
            tone="bg-purple-600"
            label="Evaluations"
            value={`${summary.evaluations_count} received`}
            sub={summary.latest_evaluation_score != null ? `Latest score: ${summary.latest_evaluation_score}` : "No evaluations yet"}
          />
        </div>
      )}

      {showAvatarModal && (
        <AvatarUploadModal user={user} onClose={() => setShowAvatarModal(false)} onUpdated={onUserUpdated} />
      )}
      {showEditModal && (
        <EditProfileModal user={user} onClose={() => setShowEditModal(false)} onUpdated={onUserUpdated} />
      )}
    </div>
  );
}
