"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";
import { greeting } from "@/lib/timeAgo";
import { plural } from "@/lib/format";
import { Card, Cols, DashHeader, DashPage, Notice, SegmentedBar, StatusChip, TextLink } from "@/components/dash";
import RevenuePanel from "./RevenuePanel";

const ACTIVE_INQUIRY_STATUSES = ["new", "contacted", "under_discussion", "approved"];
const EXPIRED_STATUSES = ["expired", "offer_expired"];
const PENDING_STATUSES = ["pending_payment", "awaiting_acceptance", "accepted"];

const INQUIRY_TONE = { new: "info", contacted: "warn", under_discussion: undefined, approved: "ok" };

function statusLabel(status) {
  return (status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DashboardPage() {
  const [schools, setSchools] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [activity, setActivity] = useState([]);
  const [aiUsage, setAiUsage] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const echoChannelRef = useRef(null);

  function load() {
    Promise.all([
      fetchSuperadminData("schools"),
      fetchSuperadminData("plan-inquiries"),
      fetchSuperadminData("activity-logs"),
      // Optional — the dashboard still loads if this one fails.
      fetchSuperadminData("ai-usage").catch(() => null),
      fetchSuperadminData("revenue").catch(() => null),
    ])
      .then(([schoolsRes, inquiriesRes, activityRes, aiRes, revenueRes]) => {
        setRevenue(revenueRes);
        setSchools(schoolsRes.schools ?? []);
        setInquiries(inquiriesRes.inquiries ?? []);
        setActivity(activityRes.logs ?? []);
        setAiUsage(aiRes);
        setError(false);
        setLoadedOnce(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  function retry() {
    setLoading(true);
    load();
  }

  useEffect(() => {
    load();
  }, []);

  // Same live-refresh signal every other Super Admin screen listens to —
  // any payment, approval, or account change re-pulls the real numbers below.
  useEffect(() => {
    const echo = getEcho();
    if (!echo) return;

    function handlePush() {
      setLastLiveUpdate(new Date());
      load();
    }

    echoChannelRef.current = echo.private("superadmin.notifications").listen(".notification.created", handlePush);

    return () => {
      echo.private("superadmin.notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
  }, []);

  const activeSchools = schools.filter((s) => s.subscription_status === "active" && !s.is_suspended);
  const suspendedSchools = schools.filter((s) => s.is_suspended);
  const expiredSchools = schools.filter((s) => EXPIRED_STATUSES.includes(s.subscription_status) && !s.is_suspended);
  const pendingSchools = schools.filter((s) => PENDING_STATUSES.includes(s.subscription_status) && !s.is_suspended);

  const pendingInquiries = inquiries.filter((i) => ACTIVE_INQUIRY_STATUSES.includes(i.status));
  // `inquiries` already comes back newest-first (see SuperadminFullController::planInquiries),
  // so the widget just takes the 4 most recent submissions regardless of status — a status-first
  // grouping would otherwise bury a brand-new inquiry behind an older one still pending review.
  const recentInquiries = inquiries.slice(0, 4);

  const expiringSoon = schools
    .filter((s) => s.days_until_expiry !== null && s.days_until_expiry !== undefined && s.days_until_expiry >= 0 && s.days_until_expiry <= 30)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry)
    .slice(0, 5);

  const aiCount = aiUsage ? (aiUsage.polished_count ?? 0) + (aiUsage.drafted_count ?? 0) : null;

  return (
    <DashPage>
      <DashHeader
        title={`${greeting()}, Super Admin`}
        sentence="Here's how the platform is doing today."
        meta={lastLiveUpdate ? `Updated live at ${lastLiveUpdate.toLocaleTimeString()}` : undefined}
      >
        <TextLink href="/superadmin/inquiries" arrow>View inquiries</TextLink>
        <TextLink href="/superadmin/billing" arrow>Billing status</TextLink>
      </DashHeader>

      {error && <Notice onRetry={retry}>We couldn&apos;t load the platform figures. Check your connection and try again.</Notice>}

      {/* Nothing is drawn until a first load worked, so a failed load never shows as zeros. */}
      {(loadedOnce || !error) && (<>
      {/* Revenue (server-side, from money actually paid) */}
      <RevenuePanel revenue={revenue} loading={loading} />

      <Card
        title="Subscriptions"
        help={loading ? undefined : `${plural(schools.length, "school")} in total${aiCount !== null && aiUsage?.feature_live ? `. AI requests this month: ${aiCount}` : ""}.`}
        action={<TextLink href="/superadmin/billing" arrow>Manage</TextLink>}
      >
        {loading ? (
          <p className="dash-empty">Loading…</p>
        ) : schools.length === 0 ? (
          <p className="dash-empty">No schools yet.</p>
        ) : (
          <SegmentedBar
            label="Schools by subscription"
            segments={[
              { key: "active", label: "Active", value: activeSchools.length, tone: "ok", href: "/superadmin/billing" },
              { key: "pending", label: "Pending", value: pendingSchools.length, tone: "warn", href: "/superadmin/billing" },
              { key: "expired", label: "Expired", value: expiredSchools.length, tone: "risk", href: "/superadmin/billing" },
              { key: "suspended", label: "Suspended", value: suspendedSchools.length, tone: "muted", href: "/superadmin/schools" },
            ]}
          />
        )}
      </Card>

      <Cols layout="even">
        <Card
          title="Recent plan inquiries"
          help={loading ? undefined : pendingInquiries.length > 0 ? `${pendingInquiries.length} still open` : "Nothing waiting for you"}
          action={<TextLink href="/superadmin/inquiries" arrow>View all</TextLink>}
        >
          {loading ? (
            <p className="dash-empty">Loading…</p>
          ) : recentInquiries.length === 0 ? (
            <p className="dash-empty">No inquiries yet.</p>
          ) : (
            <ul className="dash-list">
              {recentInquiries.map((inq) => (
                <li key={inq.id}>
                  <div className="dash-row">
                    <span className="dash-row-main">
                      <span className="dash-row-title">{inq.school_name}</span>
                      <span className="dash-row-sub">{inq.interested_plan ?? "No plan chosen"} · {inq.expected_interns ?? "—"} interns</span>
                    </span>
                    <StatusChip tone={INQUIRY_TONE[inq.status]}>{statusLabel(inq.status)}</StatusChip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Expiring soon" help="Subscriptions ending in the next 30 days." action={<TextLink href="/superadmin/billing" arrow>View all</TextLink>}>
          {loading ? (
            <p className="dash-empty">Loading…</p>
          ) : expiringSoon.length === 0 ? (
            <p className="dash-empty">Nothing ends in the next 30 days.</p>
          ) : (
            <ul className="dash-list">
              {expiringSoon.map((s) => (
                <li key={s.id}>
                  <div className="dash-row">
                    <span className="dash-row-main">
                      <span className="dash-row-title">{s.name}</span>
                      <span className="dash-row-sub">{s.plan}</span>
                    </span>
                    <span className="dash-row-side">{s.expiry}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Cols>

      <Card title="Recent system activity" action={<TextLink href="/superadmin/activity-logs" arrow>View all logs</TextLink>}>
        {loading ? (
          <p className="dash-empty">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="dash-empty">No activity recorded yet.</p>
        ) : (
          <ul className="dash-time">
            {activity.slice(0, 5).map((item) => (
              <li key={item.id}>
                <div className="dash-time-top">
                  <span className="dash-time-title">{item.action}</span>
                  <span className="dash-time-when">{item.timestamp}</span>
                </div>
                <p className="dash-time-sub">
                  {item.description}{item.school ? ` · ${item.school}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </>)}
    </DashPage>
  );
}
