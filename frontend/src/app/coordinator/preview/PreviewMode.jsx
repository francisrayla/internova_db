"use client";

import Link from "next/link";
import { tasks } from "@/components/demoData";
import { Panel, Stat, TaskBoard, AttendanceCard, EvaluationCard } from "@/components/WorkspaceShell";

export default function PreviewMode() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span>
          <strong>Preview Mode</strong> — Sample data only. No real school records, uploads, or AI requests are used here.
        </span>
        <div className="flex gap-2">
          <Link href="/coordinator/subscription" className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
            Exit Preview
          </Link>
          <Link href="/coordinator/subscription" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Proceed to Payment
          </Link>
        </div>
      </div>

      <section className="stats-grid">
        <Stat label="Total interns" value="176" note="Across 18 companies — sample" />
        <Stat label="On track" value="142" note="81% of active interns" tone="coral" />
        <Stat label="Attendance today" value="94%" note="Sample data" tone="blue" />
        <Stat label="Compliance" value="87%" note="Sample data" tone="orange" />
      </section>

      <div className="role-layout coordinator-grid">
        <Panel title="Task board" subtitle="Kanban view of a sample intern's tasks." icon="check">
          <TaskBoard initialTasks={tasks} />
        </Panel>
        <div className="role-side-stack">
          <AttendanceCard />
          <EvaluationCard />
        </div>
      </div>

      <Panel title="AI portfolio" subtitle="Auto-generated from tasks, hours, and evaluations." icon="spark" tone="lilac">
        <p className="text-sm text-slate-600">
          Alex Rivera — Web development intern · Northstar Digital (sample). &ldquo;Building with care, learning every day.&rdquo;
        </p>
      </Panel>
    </div>
  );
}
