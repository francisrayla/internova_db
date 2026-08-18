"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { useCurrentUser } from "@/lib/UserContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";

const LIVE_TYPES = [
  "task_evaluated",
  "task_comment",
  "attendance_reviewed",
  "evaluation_submitted",
  "activity_reviewed",
  "document_reviewed",
  "document_uploaded",
];

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

function ProgressBar({ pct, tone = "bg-blue-600" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function StatCard({ icon, tone, label, value, sub, pct }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}>
          <Icon name={icon} size={16} className="text-white" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      {typeof pct === "number" && <div className="mt-3"><ProgressBar pct={pct} /></div>}
    </div>
  );
}

export default function InternDashboard() {
  const { user } = useCurrentUser();
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([fetchInternData("profile-summary"), fetchInternData("tasks")])
      .then(([summaryData, tasksData]) => {
        setSummary(summaryData);
        setTasks((tasksData.tasks ?? []).slice(0, 5));
      })
      .catch(() => {
        setSummary(null);
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(LIVE_TYPES, load);

  const firstName = (user?.name || "").split(" ")[0] || "there";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">{today}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Good day, {firstName}</h1>
        <p className="mt-1 text-sm text-slate-600">Here&apos;s where things stand right now — this page updates live.</p>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          ))}
        </div>
      ) : !summary?.has_deployment ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">You&apos;re not deployed to a company yet — once your coordinator sets that up, your dashboard fills in here.</p>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon="calendar"
            tone="bg-blue-600"
            label="Hours rendered"
            value={`${summary.hours_completed}h / ${summary.required_hours}h`}
            pct={summary.hours_progress_pct}
          />
          <StatCard
            icon="check"
            tone="bg-emerald-600"
            label="Tasks"
            value={`${summary.tasks_completed} / ${summary.tasks_total}`}
            sub={summary.tasks_total > 0 ? `${summary.task_progress_pct}% complete` : "No tasks yet"}
            pct={summary.tasks_total > 0 ? summary.task_progress_pct : undefined}
          />
          <StatCard
            icon="spark"
            tone="bg-purple-600"
            label="Latest evaluation"
            value={summary.latest_evaluation_score != null ? `${summary.latest_evaluation_score}%` : "—"}
            sub={`${summary.evaluations_count} received`}
          />
          <StatCard
            icon="file"
            tone="bg-orange-500"
            label="Narrative report"
            value={summary.has_activity_today ? "Logged today" : "Not logged today"}
            sub={summary.last_activity_date ? `Last: ${summary.last_activity_date}` : "No entries yet"}
          />
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent tasks</h2>
          <Link href="/intern/tasks" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No tasks assigned yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href="/intern/tasks" className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{t.title}</p>
                    <p className="text-xs text-slate-400">{t.company_name ?? "—"}{t.due_date ? ` · Due ${t.due_date}` : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {t.status?.replace("_", " ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
