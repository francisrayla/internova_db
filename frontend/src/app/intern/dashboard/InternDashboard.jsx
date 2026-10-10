"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/lib/UserContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";
import { calendarDaysUntil, dueDateUrgency } from "@/lib/dueDateUrgency";
import { greeting } from "@/lib/timeAgo";
import { Bar, Card, Cols, DashHeader, DashPage, Notice, Skel, StatusChip, TextLink } from "@/components/dash";

const LIVE_TYPES = [
  "task_evaluated",
  "task_comment",
  "attendance_reviewed",
  "evaluation_submitted",
  "evaluation_updated",
  "activity_reviewed",
  "document_reviewed",
  "document_uploaded",
];

const URGENCY_CHIP = { red: "risk", yellow: "warn" };
const DAY_DOT = { approved: "var(--d-ok-bar)", pending: "var(--d-warn-bar)", rejected: "var(--d-risk-bar)" };
const DAY_WORD = { approved: "approved", pending: "waiting for approval", rejected: "not approved" };

/** Overdue first, then the soonest due date, then tasks without a date. Finished tasks are left out. */
function activeTasks(tasks) {
  return tasks
    .filter((t) => t.status !== "completed")
    .sort((a, b) => {
      const da = a.due_date_raw ? calendarDaysUntil(a.due_date_raw) : Infinity;
      const db = b.due_date_raw ? calendarDaysUntil(b.due_date_raw) : Infinity;
      return da - db;
    });
}

/** One cell per day (a morning + afternoon pair counts as one day): hours and the worst status that day. */
function recentDays(records) {
  const days = [];
  const byDate = new Map();
  for (const r of records) {
    let day = byDate.get(r.attendance_date);
    if (!day) {
      day = { date: r.attendance_date, hours: 0, open: false, status: "approved" };
      byDate.set(r.attendance_date, day);
      days.push(day);
    }
    if (r.hours != null) day.hours += r.hours; else day.open = true;
    if (r.status === "rejected") day.status = "rejected";
    else if (r.status === "pending" && day.status !== "rejected") day.status = "pending";
  }
  return days.slice(0, 7).reverse();
}

const shortDate = (label) => {
  const m = /^([A-Za-z]{3}) 0?(\d{1,2}),/.exec(label ?? "");
  return m ? `${m[1]} ${m[2]}` : label;
};

const hoursText = (n) => `${Math.round(n * 10) / 10}h`;

export default function InternDashboard() {
  const { user } = useCurrentUser();
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetchInternData("profile-summary"),
      fetchInternData("tasks?view=active"), // open work only; the totals come from the summary
      fetchInternData("attendance").catch(() => ({ records: [] })),
    ])
      .then(([summaryData, tasksData, attendanceData]) => {
        setSummary(summaryData);
        setTasks(tasksData.tasks ?? []);
        setRecords(attendanceData.records ?? []);
        setError(false);
      })
      .catch(() => {
        // Keep whatever is already on screen; with nothing yet, say so (never "not deployed" or zeros).
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  function retry() {
    setLoading(true);
    load();
  }

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(LIVE_TYPES, load);

  const firstName = (user?.name || "").split(" ")[0] || "there";
  const deployed = !loading && summary?.has_deployment;
  const finished = deployed && summary.is_finished;
  const required = Number(summary?.required_hours ?? 0);
  const rendered = Number(summary?.hours_completed ?? 0);
  const left = Math.max(0, required - rendered);

  const open = activeTasks(tasks);
  const days = recentDays(records);

  return (
    <DashPage>
      <DashHeader
        title={`${greeting()}, ${firstName}`}
        sentence={finished ? "You finished your required hours. Nice work." : "Here's where things stand today."}
      >
        {deployed && !finished && <TextLink className="dash-link max-sm:min-h-[44px]" href="/intern/attendance" arrow>Clock in</TextLink>}
      </DashHeader>

      {error && <Notice onRetry={retry}>We couldn&apos;t load your dashboard. Check your connection and try again.</Notice>}

      {loading ? (
        <>
          <Skel height={150} />
          <Skel height={200} />
        </>
      ) : !summary ? null : !summary.has_deployment ? (
        <Card>
          <p className="dash-note">You&apos;re not deployed to a company yet. Once your coordinator sets that up, your dashboard fills in here.</p>
        </Card>
      ) : (
        <Cols layout="even">
          <Card title="Your hours" action={<TextLink className="dash-link max-sm:min-h-[44px]" href="/intern/attendance" arrow>Attendance</TextLink>}>
            <p className="dash-big">
              {hoursText(rendered)}
              <span style={{ marginLeft: 8, fontSize: "0.9375rem", fontWeight: 400, letterSpacing: 0, color: "var(--d-muted)" }}>of {required}h required</span>
            </p>
            <Bar pct={summary.hours_progress_pct} size="thick" tone={finished ? "ok" : undefined} label="Hours rendered" />
            <div className="dash-split" style={{ marginTop: 10 }}>
              <span className="dash-note">{summary.hours_progress_pct}% done</span>
              <span className="dash-note"><strong>{hoursText(left)}</strong> left</span>
            </div>
            {finished && (
              <p className="dash-note" style={{ marginTop: 14, color: "var(--d-ok)" }}>You finished your required hours.</p>
            )}
          </Card>

          <Card
            title="Your tasks"
            help={summary.tasks_total > 0 ? `${summary.tasks_completed} of ${summary.tasks_total} done` : undefined}
            action={<TextLink className="dash-link max-sm:min-h-[44px]" href="/intern/tasks" arrow>All tasks</TextLink>}
          >
            {open.length === 0 ? (
              <p className="dash-empty">{summary.tasks_total > 0 ? "You're all caught up on tasks." : "No tasks yet."}</p>
            ) : (
              <ul className="dash-list">
                {open.slice(0, 4).map((t) => {
                  const urgency = dueDateUrgency(t.due_date_raw, t.status);
                  return (
                    <li key={t.id}>
                      <Link href="/intern/tasks" className="dash-row">
                        <span className="dash-row-main">
                          <span className="dash-row-title">{t.title}</span>
                          <span className="dash-row-sub">{t.due_date ? `Due ${t.due_date}` : "No due date"}</span>
                        </span>
                        {urgency && URGENCY_CHIP[urgency.level] ? (
                          <StatusChip tone={URGENCY_CHIP[urgency.level]}>{urgency.label}</StatusChip>
                        ) : urgency ? (
                          <span className="dash-row-side">{urgency.label}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Recent attendance" action={<TextLink className="dash-link max-sm:min-h-[44px]" href="/intern/attendance" arrow>See all</TextLink>}>
            {days.length === 0 ? (
              <p className="dash-empty">No attendance yet. Your days will show up here after you clock in.</p>
            ) : (
              <>
                <ul className="dash-days">
                  {days.map((d) => (
                    <li key={d.date} title={`${d.date}: ${DAY_WORD[d.status]}`}>
                      <span className="dash-days-date">{shortDate(d.date)}</span>
                      <span className="dash-days-hours">{d.open && d.hours === 0 ? "In" : hoursText(d.hours)}</span>
                      <i style={{ background: DAY_DOT[d.status] }} aria-label={DAY_WORD[d.status]} />
                    </li>
                  ))}
                </ul>
                <p className="dash-note" style={{ marginTop: 14 }}>
                  {summary.pending_attendance > 0
                    ? `${summary.pending_attendance} ${summary.pending_attendance === 1 ? "entry is" : "entries are"} waiting for your supervisor to approve.`
                    : "Everything so far has been looked at by your supervisor."}
                </p>
              </>
            )}
          </Card>

          <Card title="Also on your plate">
            <dl className="dash-facts">
              <div>
                <dt>Latest evaluation</dt>
                <dd>{summary.latest_evaluation_score != null ? `${Number(summary.latest_evaluation_score)}%` : "Not yet"}</dd>
              </div>
              <div>
                <dt>Today&apos;s narrative</dt>
                <dd>
                  {finished ? (
                    "Not needed"
                  ) : summary.has_activity_today ? (
                    <StatusChip tone="ok">Logged today</StatusChip>
                  ) : (
                    <TextLink className="dash-link max-sm:min-h-[44px]" href="/intern/activities" arrow>Write today&apos;s entry</TextLink>
                  )}
                </dd>
              </div>
              <div>
                <dt>Last entry</dt>
                <dd>{summary.last_activity_date ?? "None yet"}</dd>
              </div>
            </dl>
          </Card>
        </Cols>
      )}
    </DashPage>
  );
}
