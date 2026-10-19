"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";
import { useCurrentUser } from "@/lib/UserContext";
import { formatDate, greeting, timeAgo } from "@/lib/timeAgo";
import DownloadDocxButton from "@/components/narrative-report/DownloadDocxButton";
import { GROUPS, GROUP_ORDER } from "@/components/dean/monitoring";
import { plural } from "@/lib/format";
import { headAddress, headTitle } from "@/lib/headTitle";
import { Card, Col, Cols, DashHeader, DashPage, InitialsAvatar, Notice, ProgressRow, SegmentedBar, Skel, StatusChip, TextLink } from "@/components/dash";

// Same five groups as the Interns page; the bar colours say the same thing as the Pill tones there.
const GROUP_TONE = { red: "risk", amber: "warn", green: "ok", blue: "info", slate: "muted" };

const SUBSCRIPTION_LABELS = {
  active: { label: "Active", tone: "ok" },
  expired: { label: "Expired", tone: "risk" },
  offer_expired: { label: "Offer expired", tone: "risk" },
  awaiting_acceptance: { label: "Offer awaiting acceptance", tone: "warn" },
  accepted: { label: "Payment pending", tone: "warn" },
  pending_payment: { label: "Payment pending", tone: "warn" },
};

const COORDINATOR_STATUS = {
  pending: { label: "Invitation pending", tone: "warn" },
  active: { label: "Active", tone: "ok" },
  inactive: { label: "Deactivated" },
};

/** One plain sentence about the groups, so nobody has to add up the legend. */
function groupSentence(groups) {
  const risk = groups.at_risk ?? 0;
  const look = groups.needs_attention ?? 0;
  if (risk === 0 && look === 0) return "Nobody is at risk right now.";
  const parts = [];
  if (risk > 0) parts.push(`${plural(risk, "intern")} ${risk === 1 ? "is" : "are"} at risk`);
  if (look > 0) parts.push(`${look} ${risk > 0 ? "more " : ""}${look === 1 ? "needs" : "need"} a look`);
  return `${parts.join(" and ")}.`;
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

  const address = headAddress(headTitle(user), data?.dean?.name ?? user?.name);
  const today = formatDate(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const schoolName = data?.school?.name ?? user?.school_name;

  const p = data?.progress;
  const c = data?.coordinator;
  const sub = data?.subscription;
  const subStatus = SUBSCRIPTION_LABELS[sub?.status] ?? { label: sub?.status ?? "No plan yet" };

  return (
    <DashPage>
      <DashHeader
        title={`${greeting()}, ${address}`}
        sentence={schoolName ? `Here's how ${schoolName} is doing today.` : "Here's how your school is doing today."}
        meta={today}
      >
        {data && p.interns_total > 0 && (
          <DownloadDocxButton
            docxUrl="/api/dean/report/docx"
            label="Download school report"
            fallbackName="School_Monitoring_Report.docx"
            className="dash-link"
            onError={setDownloadError}
          />
        )}
      </DashHeader>

      {error && <Notice onRetry={load}>We couldn&apos;t load your overview.</Notice>}
      {downloadError && <Notice>{downloadError}</Notice>}
      {!data && !error && (
        <>
          <Skel height={170} />
          <Skel height={220} />
        </>
      )}

      {data && (
        <>
          {data.school.is_suspended && (
            <Notice>Your school&apos;s access has been paused by the Super Admin. Contact support to restore it.</Notice>
          )}

          <Card
            title="How your interns are doing"
            help={p.interns_total === 0 ? undefined : `${plural(p.interns_total, "intern")} in total`}
            action={p.interns_total > 0 ? <TextLink href="/dean/interns" arrow>See all interns</TextLink> : null}
          >
            {p.interns_total === 0 ? (
              <p className="dash-empty">No interns yet. When your coordinator adds interns and deploys them to partner companies, their progress will show up here.</p>
            ) : (
              <>
                <SegmentedBar
                  label="Interns by status"
                  segments={GROUP_ORDER.map((key) => ({
                    key,
                    label: GROUPS[key].label,
                    value: p.groups[key] ?? 0,
                    tone: GROUP_TONE[GROUPS[key].tone],
                    href: `/dean/interns?group=${key}`,
                  }))}
                />
                <p className="dash-note" style={{ marginTop: 16 }}>
                  <strong>{groupSentence(p.groups)}</strong>{" "}
                  {p.interns_active} active, {p.interns_completed} completed
                  {p.interns_pending_accounts > 0 ? `, ${p.interns_pending_accounts} not set up yet` : ""}.
                </p>
              </>
            )}
          </Card>

          <Cols layout="even">
            <Col>
              <Card title="Progress so far" help="Across every intern on your list.">
                {p.interns_total === 0 ? (
                  <p className="dash-empty">Nothing to measure yet.</p>
                ) : (
                  <>
                    <ProgressRow label="Average hours" value={`${p.average_hours_pct}%`} pct={p.average_hours_pct} help="Of the required hours, finished interns included." />
                    <ProgressRow label="Narrative reports ready" value={p.narrative_complete} of={p.interns_total} pct={(p.narrative_complete / p.interns_total) * 100} tone="ok" />
                    <ProgressRow label="Evaluations done" value={p.evaluations_done} of={p.interns_total} pct={(p.evaluations_done / p.interns_total) * 100} tone="ok" />
                  </>
                )}
              </Card>
            </Col>

            <Col>
              <Card title="Your coordinator" action={c ? <TextLink href="/dean/coordinator" arrow>View</TextLink> : null}>
                {c ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <InitialsAvatar name={c.name} url={c.avatar_url} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="dash-row-title" style={{ fontWeight: 600 }}>{c.name}</p>
                        <p className="dash-row-sub">{c.email}</p>
                      </div>
                      <StatusChip tone={COORDINATOR_STATUS[c.status]?.tone}>{COORDINATOR_STATUS[c.status]?.label}</StatusChip>
                    </div>
                    <dl className="dash-facts" style={{ marginTop: 10 }}>
                      <div><dt>Last active</dt><dd>{c.last_active_at ? timeAgo(c.last_active_at) : "Never"}</dd></div>
                      <div><dt>Actions this week</dt><dd>{c.activities_this_week}</dd></div>
                      <div><dt>Pending items</dt><dd className={c.pending_count > 0 ? "is-warn" : undefined}>{c.pending_count}</dd></div>
                      {data.setup && (
                        <div>
                          <dt>Setup</dt>
                          <dd>
                            {data.setup.done} of {data.setup.total}{" "}
                            <StatusChip tone={data.setup.done === data.setup.total ? "ok" : "warn"}>
                              {data.setup.done === data.setup.total ? "Ready" : "Needs a look"}
                            </StatusChip>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </>
                ) : (
                  <>
                    <p className="dash-note">You haven&apos;t invited a coordinator yet. Once you do, they can add companies, supervisors and interns.</p>
                    <div style={{ marginTop: 10 }}><TextLink href="/dean/coordinator/manage" arrow>Invite a coordinator</TextLink></div>
                  </>
                )}
              </Card>
            </Col>
          </Cols>

          <Card title="Recent coordinator activity" action={c ? <TextLink href="/dean/coordinator" arrow>See all</TextLink> : null}>
            {data.recent_activity.length === 0 ? (
              <p className="dash-empty">Nothing yet. When your coordinator approves documents, adds interns or updates companies, you&apos;ll see it here.</p>
            ) : (
              <ul className="dash-time">
                {data.recent_activity.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <div className="dash-time-top">
                      <span className="dash-time-title">{a.action}</span>
                      <span className="dash-time-when">{timeAgo(a.created_at)}</span>
                    </div>
                    {a.description && <p className="dash-time-sub">{a.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="dash-plan">
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 20px" }}>
              <div className="min-w-0">
                <p className="dash-row-title" style={{ fontWeight: 600, whiteSpace: "normal" }}>{sub.plan ?? "No plan"} plan</p>
                <p className="dash-row-sub" style={{ whiteSpace: "normal" }}>{sub.end_date ? `Valid until ${sub.end_date}` : "Open Billing to get started."}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <StatusChip tone={subStatus.tone}>{subStatus.label}</StatusChip>
                <TextLink href="/dean/billing" arrow>Billing</TextLink>
              </div>
            </div>
          </Card>
        </>
      )}
    </DashPage>
  );
}
