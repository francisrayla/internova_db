"use client";

import { tasks } from "@/components/demoData";
import { Cols } from "@/components/dash";
import { Btn, Page, PageHeader, Pill, Section } from "@/components/dash/page";

// Sample data only: this screen is the "preview the plan" step before payment. Nothing here is saved or sent.

const COLUMNS = [
  { key: "pending", label: "Pending" },
  { key: "ongoing", label: "Ongoing" },
  { key: "done", label: "Done" },
];
const PRIORITY_TONE = { High: "red", Medium: "amber", Low: "slate" };

// One bar per weekday: height in % and what it means (present / late / none).
const WEEK = [
  { day: "M", pct: 100, kind: "present" },
  { day: "T", pct: 100, kind: "present" },
  { day: "W", pct: 70, kind: "late" },
  { day: "T", pct: 100, kind: "present" },
  { day: "F", pct: 100, kind: "present" },
  { day: "S", pct: 8, kind: "none" },
  { day: "S", pct: 8, kind: "none" },
];
const BAR = { present: "bg-blue-600", late: "bg-amber-600", none: "bg-slate-200" };

function Figure({ label, value, note }) {
  return (
    <div className="dash-fig">
      <span className="dash-fig-label">{label}</span>
      <span className="dash-fig-value">{value}</span>
      <span className="dash-fig-note">{note}</span>
    </div>
  );
}

export default function PreviewMode() {
  return (
    <Page>
      <PageHeader
        title="Preview mode"
        sentence="Sample data only. No real school records, uploads, or AI requests are used here."
      >
        <Btn href="/dean/billing">Exit Preview</Btn>
        <Btn href="/dean/billing" variant="primary">Proceed to Payment</Btn>
      </PageHeader>

      <div className="dash-strip" style={{ "--cols": 4 }}>
        <Figure label="Total interns" value="176" note="Across 18 companies — sample" />
        <Figure label="On track" value="142" note="81% of active interns" />
        <Figure label="Attendance today" value="94%" note="Sample data" />
        <Figure label="Compliance" value="87%" note="Sample data" />
      </div>

      <Section title="Task board" help="Kanban view of a sample intern's tasks.">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="min-w-0">
                <h3 className="flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
                  {col.label}
                  <span className="k-pill is-sm">{items.length}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="pt-3 text-sm text-slate-500">No tasks</p>
                ) : (
                  <ul className="k-list">
                    {items.map((task) => (
                      <li key={task.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">{task.label}</span>
                          <Pill tone={PRIORITY_TONE[task.priority] ?? "slate"}>{task.priority}</Pill>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{task.title}</p>
                        <p className="mt-1 text-xs text-slate-600">Due {task.due} · {task.owner}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{task.doneSubtasks}/{task.subtasks} subtasks · {task.files} files · {task.comments} comments</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Cols>
        <Section title="Attendance" help="Sample week, 96% attendance.">
          <div className="flex h-28 items-end gap-2" aria-hidden>
            {WEEK.map((d, i) => (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <div className={`w-full rounded-t-sm ${BAR[d.kind]}`} style={{ height: `${d.pct}%` }} />
                <span className="text-xs text-slate-500">{d.day}</span>
              </div>
            ))}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden /> Present</li>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden /> Late</li>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden /> No work day</li>
          </ul>
        </Section>

        <Section title="Latest evaluation" help="Mia Santos · Aug 7 · Formal evaluation" action={<Pill tone="blue">92%</Pill>}>
          <blockquote className="border-l-2 border-slate-300 pl-4 text-sm leading-relaxed text-slate-700">
            &ldquo;Francis is dependable and takes initiative when solving unfamiliar problems.&rdquo;
          </blockquote>
        </Section>
      </Cols>

      <Section title="AI portfolio" help="Auto-generated from tasks, hours, and evaluations.">
        <p className="text-sm text-slate-700">
          Alex Rivera — Web development intern · Northstar Digital (sample). &ldquo;Building with care, learning every day.&rdquo;
        </p>
      </Section>
    </Page>
  );
}
