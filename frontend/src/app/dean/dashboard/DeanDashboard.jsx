"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchApiData } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";
import { formatDate, greeting, timeAgo } from "@/lib/timeAgo";
import Icon from "@/components/Icon";
import DownloadDocxButton from "@/components/narrative-report/DownloadDocxButton";
import { GROUPS, GROUP_ORDER } from "@/components/dean/monitoring";
import { Avatar, EmptyState, ErrorNote, MODULE_ICON, Pill, ProgressBar, SectionTitle, Skeleton, SkeletonList } from "@/components/dean/ui";

const ALERT_STYLE = {
  red: { box: "border-red-200 bg-red-50", dot: "bg-red-100 text-red-700", icon: "bell" },
  amber: { box: "border-amber-200 bg-amber-50", dot: "bg-amber-100 text-amber-700", icon: "bell" },
  blue: { box: "border-blue-200 bg-blue-50", dot: "bg-blue-100 text-blue-700", icon: "mail" },
};

const GROUP_BOX = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
};

const SUBSCRIPTION_LABELS = {
  active: { label: "Active", tone: "green" },
  expired: { label: "Expired", tone: "red" },
  offer_expired: { label: "Offer expired", tone: "red" },
  awaiting_acceptance: { label: "Offer awaiting acceptance", tone: "amber" },
  accepted: { label: "Payment pending", tone: "amber" },
  pending_payment: { label: "Payment pending", tone: "amber" },
};

const COORDINATOR_STATUS = {
  pending: { label: "Invitation pending", tone: "amber" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Deactivated", tone: "slate" },
};

function AlertCard({ alert }) {
  const style = ALERT_STYLE[alert.level] ?? ALERT_STYLE.blue;
  return (
    <Link href={alert.link} className={`flex items-start gap-3 rounded-2xl border p-4 transition hover:shadow-sm ${style.box}`}>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.dot}`}>
        <Icon name={style.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{alert.title}</span>
        <span className="block text-sm text-slate-600">{alert.text}</span>
      </span>
      <span className="self-center text-slate-400"><Icon name="arrow" size={16} /></span>
    </Link>
  );
}

function Stat({ label, value, of, pct, help }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <p className="text-xs font-semibold text-slate-500 sm:text-sm">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 sm:text-xl">
        {value}
        {of !== undefined && <span className="text-base font-medium text-slate-500"> of {of}</span>}
      </p>
      {pct !== undefined && <div className="mt-2"><ProgressBar pct={pct} label={label} /></div>}
      {help && <p className="mt-2 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export default function DeanDashboard() {
  const { user } = useCurrentUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const load = useCallback(() => {
    fetchApiData("dean", "overview").then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const lastName = (data?.dean?.name ?? user?.name ?? "").trim().split(/\s+/).slice(-1)[0];
  const today = formatDate(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const p = data?.progress;
  const c = data?.coordinator;
  const sub = data?.subscription;
  const subStatus = SUBSCRIPTION_LABELS[sub?.status] ?? { label: sub?.status ?? "No plan yet", tone: "slate" };

  return (
    <div className="space-y-6 sm:p-2 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {greeting()}, Dean {lastName}
        </h1>
        <p className="mt-1 text-slate-600">
          {data?.school?.name ?? user?.school_name} · {today}
        </p>
      </div>

      {error && <ErrorNote onRetry={load}>We couldn&apos;t load your overview.</ErrorNote>}
      {!data && !error && (
        <div className="space-y-6">
          <SkeletonList rows={2} height="h-16" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      )}

      {data && (
        <>
          {data.school.is_suspended && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Your school&apos;s access has been paused by the Super Admin. Contact support to restore it.
            </div>
          )}

          <section>
            <SectionTitle title="Needs your attention" help="Things that are late or need a nudge, worked out from your school's real activity." />
            {data.alerts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={18} /></span>
                <div>
                  <p className="font-semibold text-slate-900">All clear</p>
                  <p className="text-sm text-slate-600">Nothing is late or waiting on anyone right now. We&apos;ll flag it here when something needs you.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {data.alerts.map((a) => <AlertCard key={a.key} alert={a} />)}
              </div>
            )}
          </section>

          <section>
            <SectionTitle title="School progress" help="How your interns are doing overall." action={<Link href="/dean/interns" className="text-sm font-semibold text-blue-700 hover:underline">See all interns →</Link>} />
            {downloadError && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{downloadError}</p>}
            {p.interns_total === 0 ? (
              <EmptyState icon="users" title="No interns yet" text="When your coordinator adds interns and deploys them to partner companies, their progress will show up here." />
            ) : (
              <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {GROUP_ORDER.map((key) => (
                  <Link key={key} href={`/dean/interns?group=${key}`} className={`min-w-0 rounded-2xl border px-3 py-3 transition hover:shadow-sm ${GROUP_BOX[GROUPS[key].tone]}`}>
                    <span className="block text-xl font-bold">{p.groups[key]}</span>
                    <span className="block truncate text-sm font-semibold">{GROUPS[key].label}</span>
                  </Link>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Interns" value={p.interns_active} help={`active now, ${p.interns_completed} completed`} />
                <Stat label="Average hours" value={`${p.average_hours_pct}%`} pct={p.average_hours_pct} help="of the required hours rendered" />
                <Stat label="Narrative reports ready" value={p.narrative_complete} of={p.interns_total} pct={(p.narrative_complete / p.interns_total) * 100} />
                <Stat label="Evaluations done" value={p.evaluations_done} of={p.interns_total} pct={(p.evaluations_done / p.interns_total) * 100} />
              </div>
              <DownloadDocxButton
                docxUrl="/api/dean/report/docx"
                label="Download school report (.docx)"
                fallbackName="School_Monitoring_Report.docx"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onError={setDownloadError}
              />
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section>
              <SectionTitle title="Coordinator at a glance" help="Who is running day-to-day and how active they are." />
              {c ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} url={c.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{c.name}</p>
                      <p className="truncate text-sm text-slate-500">{c.email}</p>
                    </div>
                    <Pill tone={COORDINATOR_STATUS[c.status]?.tone}>{COORDINATOR_STATUS[c.status]?.label}</Pill>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center sm:gap-3">
                    <div className="rounded-xl bg-slate-50 px-1.5 py-2.5 sm:p-3">
                      <dt className="text-[11px] leading-tight text-slate-500 sm:text-xs">Last active</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">{c.last_active_at ? timeAgo(c.last_active_at) : "Never"}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-1.5 py-2.5 sm:p-3">
                      <dt className="text-[11px] leading-tight text-slate-500 sm:text-xs">Actions this week</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">{c.activities_this_week}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-1.5 py-2.5 sm:p-3">
                      <dt className="text-[11px] leading-tight text-slate-500 sm:text-xs">Pending items</dt>
                      <dd className={`mt-1 text-sm font-semibold ${c.pending_count > 0 ? "text-amber-700" : "text-slate-900"}`}>{c.pending_count}</dd>
                    </div>
                  </dl>
                  {data.setup && (
                    <Link href="/dean/coordinator" className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-600">Setup {data.setup.done} of {data.setup.total}</span>
                      <Pill tone={data.setup.done === data.setup.total ? "green" : "amber"}>{data.setup.done === data.setup.total ? "Ready" : "Needs a look"}</Pill>
                    </Link>
                  )}
                  <Link href="/dean/coordinator" className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:underline">View coordinator →</Link>
                </div>
              ) : (
                <EmptyState
                  icon="user"
                  title="No coordinator yet"
                  text="Invite a coordinator so someone can add companies, supervisors and interns."
                  action={<Link href="/dean/coordinator/manage" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Invite a coordinator</Link>}
                />
              )}
            </section>

            <section>
              <SectionTitle title="Recent coordinator activity" help="The latest things your coordinator did." action={c && <Link href="/dean/coordinator" className="text-sm font-semibold text-blue-700 hover:underline">See all →</Link>} />
              {data.recent_activity.length === 0 ? (
                <EmptyState icon="list" title="Nothing yet" text="When your coordinator approves documents, adds interns or updates companies, you'll see it here." />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                  {data.recent_activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Icon name={MODULE_ICON[a.module] ?? "list"} size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{a.action}</p>
                        {a.description && <p className="truncate text-sm text-slate-500">{a.description}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <Link href="/dean/billing" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-blue-300">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icon name="card" size={18} /></span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">{sub.plan ?? "No plan"} subscription</span>
                <span className="block text-xs text-slate-500">{sub.end_date ? `Valid until ${sub.end_date}` : "Open Billing to get started"}</span>
              </span>
            </span>
            <span className="flex items-center gap-3">
              <Pill tone={subStatus.tone}>{subStatus.label}</Pill>
              <span className="text-sm font-semibold text-blue-700">Billing →</span>
            </span>
          </Link>
        </>
      )}
    </div>
  );
}
