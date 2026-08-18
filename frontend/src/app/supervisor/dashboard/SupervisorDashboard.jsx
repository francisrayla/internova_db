"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSupervisorData } from "@/lib/supervisorApi";

export default function SupervisorDashboard() {
  const [interns, setInterns] = useState([]);
  const [pendingAttendance, setPendingAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Supervisor");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("internova_user") || "null");
      if (stored?.name) setName(stored.name.split(" ")[0]);
    } catch {
      // ignore
    }

    Promise.all([
      fetchSupervisorData("interns"),
      fetchSupervisorData("attendance?status=pending"),
    ])
      .then(([internsRes, attendanceRes]) => {
        setInterns(internsRes.interns ?? []);
        setPendingAttendance(attendanceRes.records ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const activeInterns = interns.filter((i) => i.status === "active");
  const avgHoursProgress = activeInterns.length
    ? Math.round(activeInterns.reduce((sum, i) => sum + i.hours_progress_pct, 0) / activeInterns.length)
    : 0;

  const stats = [
    { label: "Assigned Interns", value: interns.length, note: `${activeInterns.length} active`, href: "/supervisor/interns" },
    { label: "Avg. Hours Progress", value: `${avgHoursProgress}%`, note: "Across active interns", href: "/supervisor/interns" },
    { label: "Attendance To Review", value: pendingAttendance.length, note: pendingAttendance.length > 0 ? "Awaiting your review" : "All caught up", href: "/supervisor/attendance", urgent: pendingAttendance.length > 0 },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-600 to-blue-800 p-6 text-white shadow-sm">
        <h2 className="text-2xl font-bold">Good day, {name} 👋</h2>
        <p className="mt-1 text-sm text-blue-100">A clear pulse on the interns assigned to you.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/supervisor/interns" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            View Interns
          </Link>
          <Link href="/supervisor/attendance" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            Attendance
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)
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

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Intern Progress</h3>
          <Link href="/supervisor/interns" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : interns.length === 0 ? (
            <p className="text-sm text-slate-500">No interns are assigned to you yet.</p>
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
      </section>
    </div>
  );
}
