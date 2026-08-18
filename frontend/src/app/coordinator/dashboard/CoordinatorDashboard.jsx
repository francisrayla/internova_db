"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

export default function CoordinatorDashboard() {
  const [interns, setInterns] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [pendingDocuments, setPendingDocuments] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Coordinator");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("internova_user") || "null");
      if (stored?.name) setName(stored.name.split(" ")[0]);
    } catch {
      // ignore
    }

    Promise.all([
      fetchCoordinatorData("interns"),
      fetchCoordinatorData("tasks"),
      fetchCoordinatorData("documents?status=pending"),
      fetchCoordinatorData("evaluations"),
    ])
      .then(([internsRes, tasksRes, documentsRes, evalRes]) => {
        setInterns(internsRes.interns ?? []);
        setTasks(tasksRes.tasks ?? []);
        setPendingDocuments(documentsRes.documents ?? []);
        setEvaluations(evalRes.evaluations ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const activeInterns = interns.filter((i) => i.status === "active");
  const avgHoursProgress = activeInterns.length
    ? Math.round(activeInterns.reduce((sum, i) => sum + i.hours_progress_pct, 0) / activeInterns.length)
    : 0;

  const tasksTotal = tasks.length;
  const tasksDone = tasks.filter((t) => t.status === "completed").length;
  const taskCompletionPct = tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0;

  const stats = [
    { label: "Total Interns", value: interns.length, note: `${activeInterns.length} active`, href: "/coordinator/interns" },
    { label: "Avg. Hours Progress", value: `${avgHoursProgress}%`, note: "Across active interns", href: "/coordinator/interns" },
    { label: "Task Completion", value: `${taskCompletionPct}%`, note: `${tasksDone}/${tasksTotal} tasks done`, href: "/coordinator/tasks" },
    { label: "Documents to Review", value: pendingDocuments.length, note: pendingDocuments.length > 0 ? "Awaiting your review" : "All caught up", href: "/coordinator/documents", urgent: pendingDocuments.length > 0 },
  ];

  // Attendance is verified by each intern's supervisor now, not the coordinator —
  // shown here as read-only awareness, not something framed as "your" review.
  const reviewItems = pendingDocuments
    .map((d) => ({ key: `d-${d.id}`, label: `${d.intern_name} — ${d.document_type}`, meta: d.uploaded_at, href: "/coordinator/documents" }))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-600 to-blue-800 p-6 text-white shadow-sm">
        <h2 className="text-2xl font-bold">Good day, {name} 👋</h2>
        <p className="mt-1 text-sm text-blue-100">A clear pulse on every intern, task, and requirement.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/coordinator/interns" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            View Interns
          </Link>
          <Link href="/coordinator/tasks" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            Assign a Task
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)
          : stats.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                <p className="mt-3 text-3xl font-bold text-slate-900">{item.value}</p>
                <p className={`mt-2 text-xs font-medium ${item.urgent ? "text-red-600" : "text-blue-600"}`}>{item.note}</p>
              </Link>
            ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Intern Progress</h3>
            <Link href="/coordinator/interns" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : interns.length === 0 ? (
              <p className="text-sm text-slate-500">No interns have been deployed yet.</p>
            ) : (
              interns.slice(0, 5).map((i) => (
                <div key={i.deployment_id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{i.intern_name}</p>
                    <p className="text-xs text-slate-500">{i.company_name ?? "—"}</p>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${i.hours_progress_pct}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-semibold text-slate-600">{i.hours_progress_pct}%</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Documents to Review</h3>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : reviewItems.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing pending — you&apos;re all caught up.</p>
            ) : (
              reviewItems.map((item) => (
                <Link key={item.key} href={item.href} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2.5 hover:bg-amber-100">
                  <span className="truncate text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="shrink-0 text-xs text-slate-500">{item.meta}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Recent Evaluations</h3>
          <Link href="/coordinator/evaluations" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-slate-500">No evaluations submitted yet.</p>
          ) : (
            evaluations.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{e.intern_name} — {e.evaluation_type}</p>
                  <p className="text-xs text-slate-500">{e.evaluation_date}</p>
                </div>
                {e.overall_score != null && <span className="shrink-0 text-sm font-semibold text-slate-900">{e.overall_score}%</span>}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
