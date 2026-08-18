"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import { useCurrentUser } from "@/lib/UserContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";

const LIVE_TYPES = [
  "task_evaluated",
  "task_comment",
  "attendance_reviewed",
  "evaluation_submitted",
  "activity_reviewed",
];

function initialsOf(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

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
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
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
        <div className="flex flex-wrap items-center gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-600 text-2xl font-semibold text-white ring-4 ring-blue-50">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">My Profile</p>
            <h1 className="mt-1 truncate text-xl font-semibold text-slate-900">{user?.name ?? "Intern"}</h1>
            <p className="truncate text-sm text-slate-500">{user?.email ?? "—"}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAvatarModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="camera" size={15} /> Change photo
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
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
        </div>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          ))}
        </div>
      ) : !summary?.has_deployment ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">You&apos;re not deployed to a company yet — once your coordinator sets that up, your progress will show up here.</p>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
    </div>
  );
}
