"use client";

import { useCallback, useEffect, useState } from "react";
import FileLink from "@/components/FileViewer";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchApiData } from "@/lib/apiFetch";
import { useUrlTab } from "@/lib/useUrlTab";
import { formatDate, timeAgo } from "@/lib/timeAgo";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";
import AttendanceSelfies from "@/components/AttendanceSelfies";
import RedFlagBadge from "@/components/RedFlagBadge";
import DownloadDocxButton from "@/components/narrative-report/DownloadDocxButton";
import { AttendanceCalendar, GroupPill, Projection } from "@/components/dean/monitoring";
import { EmptyState, ErrorNote, Pill, Skeleton, SkeletonList, TabBar } from "@/components/dean/ui";
import { Bar, Cols } from "@/components/dash";
import { Page, PageHeader, Section, btnClass } from "@/components/dash/page";
import DeploymentHistory from "@/components/DeploymentHistory";

const TAB_KEYS = ["attendance", "journal", "tasks", "evaluations", "documents", "narrative"];

const STATUS = { active: { label: "Active", tone: "green" }, completed: { label: "Completed", tone: "blue" }, inactive: { label: "Archived", tone: "slate" } };
const ATTENDANCE_TONE = { approved: "green", pending: "amber", rejected: "red" };
const DOC_TONE = { approved: "green", pending: "amber", rejected: "red" };
const ACTIVITY_LABEL = { approved: ["Approved", "green"], pending: ["Waiting for supervisor", "amber"], rejected: ["Rejected", "red"], recorded: ["Recorded automatically", "blue"] };
const TASK_TONE = { completed: "green", in_progress: "blue", pending: "slate" };

// One figure of the strip at the top: label, value, optional bar and note.
function Stat({ label, children, help }) {
  return (
    <div className="dash-fig">
      <span className="dash-fig-label">{label}</span>
      <span className="dash-fig-value">{children}</span>
      {help && <span className="dash-fig-note">{help}</span>}
    </div>
  );
}

// The server sends the newest rows only; say so when older ones exist instead of looking like the whole history.
function CapNote({ shown, total, what }) {
  if (!total || total <= shown) return null;
  return <p className="mt-2 text-xs text-slate-500" role="note">Showing the latest {shown} of {total} {what}. Older ones are not listed here.</p>;
}

function List({ children }) {
  return (
    <div className="dash-card is-flush">
      <ul className="k-list">{children}</ul>
    </div>
  );
}

function AttendanceTab({ rows, total }) {
  if (rows.length === 0) return <EmptyState icon="calendar" title="No attendance yet" text="Clock-ins and clock-outs will show here once the intern starts their shifts." />;
  return (
    <>
    <List>
      {rows.map((a) => (
        <li key={a.id} className={`k-item flex flex-wrap items-center justify-between gap-2 border-l-4 ${a.red_flag ? "border-l-red-600" : "border-l-transparent"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <AttendanceSelfies record={{ ...a, attendance_date: formatDate(a.date) }} />
            <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{formatDate(a.date, { weekday: "short", month: "short", day: "numeric" })}</p>
            <RedFlagBadge record={a} className="my-0.5" />
            <p className="text-sm text-slate-500">
              {a.session_label ? `${a.session_label}: ` : ""}{a.clock_in ?? "—"} to {a.clock_out ?? (a.clock_in ? "still clocked in" : "—")}
              {a.hours !== null && <> · <span className="font-medium text-slate-700">{a.hours} h</span></>}
              {a.auto_clocked_out && " · clocked out automatically"}
              {a.edited && " · time corrected by the supervisor"}
            </p>
            </div>
          </div>
          <Pill tone={ATTENDANCE_TONE[a.status] ?? "slate"}>{a.status}</Pill>
        </li>
      ))}
    </List>
    <CapNote shown={rows.length} total={total} what="attendance records" />
    </>
  );
}

function JournalTab({ rows, total }) {
  if (rows.length === 0) return <EmptyState icon="file" title="No journal entries yet" text="Daily activity entries the intern writes (and ones the system records from attendance) will appear here." />;
  return (
    <>
    <List>
      {rows.map((a) => {
        const [label, tone] = ACTIVITY_LABEL[a.status] ?? [a.status, "slate"];
        return (
          <li key={a.id} className="k-item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{a.title}</p>
              <Pill tone={tone}>{label}</Pill>
            </div>
            <p className="text-xs text-slate-400">{formatDate(a.date)}</p>
            {a.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{a.description}</p>}
          </li>
        );
      })}
    </List>
    <CapNote shown={rows.length} total={total} what="journal entries" />
    </>
  );
}

function TasksTab({ rows, total }) {
  if (rows.length === 0) return <EmptyState icon="list" title="No tasks yet" text="Tasks the supervisor assigns to this intern will be listed here." />;
  return (
    <>
    <List>
      {rows.map((t) => (
        <li key={t.id} className="k-item">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{t.title}</p>
            <Pill tone={TASK_TONE[t.status] ?? "slate"}>{t.status.replace("_", " ")}</Pill>
          </div>
          <p className="text-xs text-slate-500">
            {t.due_date ? `Due ${formatDate(t.due_date)}` : "No due date"}
            {t.subtask_total > 0 && ` · ${t.subtask_done} of ${t.subtask_total} subtasks done`}
            {t.rating !== null && ` · Supervisor rating ${t.rating}/10`}
          </p>
          {t.description && <p className="mt-1 break-words text-sm text-slate-600">{t.description}</p>}
        </li>
      ))}
    </List>
    <CapNote shown={rows.length} total={total} what="tasks" />
    </>
  );
}

function EvaluationsTab({ rows }) {
  if (rows.length === 0) return <EmptyState icon="check" title="No evaluations yet" text="The supervisor's formal evaluation will appear here once it is submitted." />;
  return (
    <div className="space-y-3">
      {rows.map((e) => (
        <div key={e.id} className="dash-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Internship evaluation</p>
            <Pill tone="blue">Overall {Number(e.overall_score)}%</Pill>
          </div>
          <p className="text-xs text-slate-500">{formatDate(e.evaluation_date)}{e.evaluator_name && ` · by ${e.evaluator_name}`}</p>
          {e.remarks && <p className="mt-2 text-sm text-slate-600">{e.remarks}</p>}
          {e.scores.length > 0 && (
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {e.scores.map((s, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-slate-600">{s.criterion_name}</span>
                  <span className="font-medium text-slate-800">{Number(s.score)} / {Number(s.max_score)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ rows }) {
  if (rows.length === 0) return <EmptyState icon="file" title="No documents yet" text="Documents the intern or coordinator uploads (resume, waiver, endorsement letter and others) will be listed here." />;
  return (
    <List>
      {rows.map((d) => (
        <li key={d.id} className="k-item flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{d.document_type}</p>
            <p className="truncate text-sm text-slate-500">{d.file_name} · uploaded {timeAgo(d.uploaded_at)}</p>
            {d.remarks && <p className="text-xs text-slate-500">Remarks: {d.remarks}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Pill tone={DOC_TONE[d.status] ?? "slate"}>{d.status === "pending" ? "Awaiting review" : d.status}</Pill>
            <FileLink url={d.file_url} name={d.file_name} subtitle={d.document_type} className="text-sm font-semibold text-blue-700 hover:underline">View</FileLink>
          </div>
        </li>
      ))}
    </List>
  );
}

function NarrativeTab({ deploymentId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const load = useCallback(() => {
    fetchApiData("dean", `interns/${deploymentId}/narrative-report`).then((d) => { setReport(d); setError(false); }).catch(() => setError(true));
  }, [deploymentId]);

  useEffect(load, [load]);

  if (error) return <ErrorNote onRetry={load}>We couldn&apos;t load the narrative report.</ErrorNote>;
  if (!report) return <SkeletonList rows={2} height="h-24" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link href={`/dean/interns/${deploymentId}/narrative-report`} className={btnClass("primary")}>Open narrative report</Link>
        <DownloadDocxButton
          docxUrl={`/api/dean/interns/${deploymentId}/narrative-report/docx`}
          label="Download Word"
          className={btnClass("secondary")}
          onError={setDownloadError}
        />
      </div>
      {downloadError && <p className="k-note is-risk" role="alert">{downloadError}</p>}
      <NarrativeChecklist report={report} />
    </div>
  );
}

export default function InternDetail() {
  const { deploymentId } = useParams();
  const [tab, setTab] = useUrlTab(TAB_KEYS, "attendance");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchApiData("dean", `interns/${deploymentId}`)
      .then((d) => { setData(d); setError(""); })
      .catch((err) => setError(/404|not found/i.test(err.message) ? "We couldn't find that intern." : "We couldn't load this intern."));
  }, [deploymentId]);

  useEffect(load, [load]);

  const i = data?.intern;
  const status = STATUS[i?.status] ?? { label: i?.status, tone: "slate" };

  return (
    <Page>
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}
      {!data && !error && (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-24" />)}</div>
        </div>
      )}

      {data && (
        <>
          <PageHeader
            back={{ href: "/dean/interns", label: "All interns" }}
            title={
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                {i.intern_name}
                {i.status_group && i.status_group !== "inactive" ? <GroupPill group={i.status_group} /> : <Pill tone={status.tone}>{status.label}</Pill>}
              </span>
            }
            sentence={[i.course, i.year_level, i.student_number && `Student no. ${i.student_number}`].filter(Boolean).join(" · ")}
            meta={`${i.company_name ?? "No company"} · Supervisor: ${i.supervisor_name ?? "none yet"} · ${formatDate(i.start_date)} – ${i.end_date ? formatDate(i.end_date) : "present"}`}
          />
          {i.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {i.flags.map((f) => <Pill key={f.key} tone={f.level}>{f.label}</Pill>)}
            </div>
          )}

          <div className="dash-strip" style={{ "--cols": 4 }}>
            <Stat label="Hours" help={`${i.hours_progress_pct}% of the required hours`}>
              {i.hours_completed} <small className="text-sm font-normal text-slate-500">of {i.required_hours}</small>
              <Bar pct={i.hours_progress_pct} size="thin" label="Hours progress" />
            </Stat>
            <Stat label="Narrative report" help="requirements complete">
              {i.narrative_done} <small className="text-sm font-normal text-slate-500">of {i.narrative_total}</small>
            </Stat>
            <Stat label="Tasks" help="completed">
              {data.summary.tasks_completed} <small className="text-sm font-normal text-slate-500">of {data.summary.tasks_total}</small>
            </Stat>
            <Stat label="Last clock-in" help={data.summary.latest_evaluation_score ? `Latest evaluation ${Number(data.summary.latest_evaluation_score)}%` : "No evaluation yet"}>
              <span className="text-base font-medium">{i.last_clock_in_at ? timeAgo(i.last_clock_in_at) : "Never"}</span>
            </Stat>
          </div>

          <Cols>
            <Section title="Projected finish">
              <Projection projection={i.projection} />
              <p className="mt-2 text-xs text-slate-500">
                {i.projection?.pace_hours_per_day ? `Based on about ${i.projection.pace_hours_per_day} hours per working day lately (Mon to Fri). ` : ""}
                {i.end_date ? `Deployment ends ${formatDate(i.end_date)}.` : "No end date set for this deployment."}
              </p>
              {i.status_reasons?.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                  {i.status_reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
            </Section>
            <Section title="Attendance, last 4 weeks">
              <AttendanceCalendar calendar={i.calendar} />
            </Section>
          </Cols>

          <DeploymentHistory history={data.history} />

          <TabBar
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "attendance", label: "Attendance" },
              { key: "journal", label: "Daily journal" },
              { key: "tasks", label: "Tasks", count: data.totals?.tasks ?? data.tasks.length },
              { key: "evaluations", label: "Evaluations", count: data.evaluations.length },
              { key: "documents", label: "Documents", count: data.documents.length },
              { key: "narrative", label: "Narrative report" },
            ]}
          />

          <div>
            {tab === "attendance" && <AttendanceTab rows={data.attendance} total={data.totals?.attendance} />}
            {tab === "journal" && <JournalTab rows={data.activities} total={data.totals?.activities} />}
            {tab === "tasks" && <TasksTab rows={data.tasks} total={data.totals?.tasks} />}
            {tab === "evaluations" && <EvaluationsTab rows={data.evaluations} />}
            {tab === "documents" && <DocumentsTab rows={data.documents} />}
            {tab === "narrative" && <NarrativeTab deploymentId={deploymentId} />}
          </div>
          <p className="text-xs text-slate-400">You&apos;re viewing this in read-only mode. Your coordinator and the intern&apos;s supervisor manage the records.</p>
        </>
      )}
    </Page>
  );
}
