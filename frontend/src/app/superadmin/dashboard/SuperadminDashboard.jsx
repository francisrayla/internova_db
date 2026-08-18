"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { getEcho } from "@/lib/echo";

const ACTIVE_INQUIRY_STATUSES = ["new", "contacted", "under_discussion", "approved"];
const EXPIRED_STATUSES = ["expired", "offer_expired"];
const PENDING_STATUSES = ["pending_payment", "awaiting_acceptance", "accepted"];

const INQUIRY_STATUS_STYLE = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  under_discussion: "bg-purple-100 text-purple-700",
  approved: "bg-blue-100 text-blue-700",
};

function statusLabel(status) {
  return (status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DashboardPage() {
  const [schools, setSchools] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const echoChannelRef = useRef(null);

  function load() {
    Promise.all([
      fetchSuperadminData("schools"),
      fetchSuperadminData("plan-inquiries"),
      fetchSuperadminData("activity-logs"),
    ])
      .then(([schoolsRes, inquiriesRes, activityRes]) => {
        setSchools(schoolsRes.schools ?? []);
        setInquiries(inquiriesRes.inquiries ?? []);
        setActivity(activityRes.logs ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    echoChannelRef.current = echo.channel("superadmin-notifications").listen(".notification.created", handlePush);

    return () => {
      echo.channel("superadmin-notifications").stopListening(".notification.created", handlePush);
      echoChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSchools = schools.filter((s) => s.subscription_status === "active" && !s.is_suspended);
  const suspendedSchools = schools.filter((s) => s.is_suspended);
  const expiredSchools = schools.filter((s) => EXPIRED_STATUSES.includes(s.subscription_status) && !s.is_suspended);
  const pendingSchools = schools.filter((s) => PENDING_STATUSES.includes(s.subscription_status) && !s.is_suspended);

  const monthlyRevenue = activeSchools.reduce((sum, s) => {
    const amount = Number(s.amount ?? 0);
    return sum + (s.billing_period === "yearly" ? amount / 12 : amount);
  }, 0);

  const pendingInquiries = inquiries.filter((i) => ACTIVE_INQUIRY_STATUSES.includes(i.status));
  // Pending ones need a decision — surface those first, then fill any remaining
  // slots with the most recent resolved ones so the widget isn't ever empty.
  const resolvedInquiries = inquiries.filter((i) => !ACTIVE_INQUIRY_STATUSES.includes(i.status));
  const recentInquiries = [...pendingInquiries, ...resolvedInquiries].slice(0, 3);

  const expiringSoon = schools
    .filter((s) => s.days_until_expiry !== null && s.days_until_expiry !== undefined && s.days_until_expiry >= 0 && s.days_until_expiry <= 30)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry)
    .slice(0, 5);

  const totalForPercent = schools.length || 1;
  const activePercent = Math.round((activeSchools.length / totalForPercent) * 100);

  const stats = [
    { label: "Total Schools", value: schools.length, note: "Approved tenants", href: "/superadmin/schools", urgent: false },
    { label: "Active Subscriptions", value: activeSchools.length, note: "Currently paying and active", href: "/superadmin/billing", urgent: false },
    { label: "Pending Inquiries", value: pendingInquiries.length, note: pendingInquiries.length > 0 ? "Awaiting your review" : "All caught up", href: "/superadmin/inquiries", urgent: pendingInquiries.length > 0 },
    { label: "Expired / Offer Expired", value: expiredSchools.length, note: expiredSchools.length > 0 ? "Needs follow-up" : "Nothing overdue", href: "/superadmin/billing", urgent: expiredSchools.length > 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-600 to-blue-800 p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Good day, Super Admin 👋</h2>
            <p className="mt-1 text-sm text-blue-100">Here&apos;s your platform at a glance.</p>
          </div>
          {lastLiveUpdate && (
            <span className="flex items-center gap-1.5 text-xs text-blue-100">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Live — updated {lastLiveUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/superadmin/inquiries" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            View Inquiries
          </Link>
          <Link href="/superadmin/billing" className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
            Billing Status
          </Link>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            ))
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

      {/* Revenue + AI row */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. Monthly Revenue</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            ₱{monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="mt-1 text-xs text-blue-600">from {activeSchools.length} active subscription{activeSchools.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Requests This Month</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">0</p>
          <Link href="/superadmin/ai-usage" className="mt-1 text-xs text-blue-600 hover:underline">
            AI generation isn&apos;t live yet — view entitlement →
          </Link>
        </div>
      </section>

      {/* Main 3-column grid */}
      <section className="grid gap-6 lg:grid-cols-3">

        {/* Recent plan inquiries */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Recent Plan Inquiries</h3>
            <Link href="/superadmin/inquiries" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : recentInquiries.length === 0 ? (
              <p className="text-sm text-slate-500">No inquiries yet</p>
            ) : (
              recentInquiries.map((inq) => (
                <div key={inq.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{inq.school_name}</p>
                    <p className="text-xs text-slate-500">{inq.interested_plan ?? "—"} · {inq.expected_interns ?? "—"} interns</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${INQUIRY_STATUS_STYLE[inq.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabel(inq.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Subscription status */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Subscription Status</h3>
            <Link href="/superadmin/billing" className="text-xs font-semibold text-blue-600 hover:underline">Manage</Link>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { label: "Active", value: activeSchools.length, color: "bg-blue-500" },
              { label: "Pending", value: pendingSchools.length, color: "bg-amber-500" },
              { label: "Expired", value: expiredSchools.length, color: "bg-red-500" },
              { label: "Suspended", value: suspendedSchools.length, color: "bg-slate-400" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${row.color}`} />
                <span className="flex-1 text-sm text-slate-700">{row.label}</span>
                <span className="text-sm font-semibold text-slate-900">{row.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${activePercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{activePercent}% active</p>
        </div>

        {/* Expiring soon */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Expiring Soon</h3>
            <Link href="/superadmin/billing" className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : expiringSoon.length === 0 ? (
              <p className="text-sm text-slate-500">No subscriptions expiring in the next 30 days</p>
            ) : (
              expiringSoon.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-orange-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.plan}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">{s.expiry}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Recent activity */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Recent System Activity</h3>
          <Link href="/superadmin/activity-logs" className="text-xs font-semibold text-blue-600 hover:underline">View all logs</Link>
        </div>
        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-slate-500">No activity recorded yet.</p>
          ) : (
            activity.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{item.action}</p>
                  <p className="text-xs text-slate-500">
                    {item.description}{item.school ? ` · ${item.school}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{item.timestamp}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
