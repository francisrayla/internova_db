"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { useAttention } from "@/lib/useAttention";
import AttentionQueue from "@/components/AttentionQueue";
import Pagination from "@/components/Pagination";
import { Btn, DataList, EmptyState, Page, PageHeader, Section, SkeletonList } from "@/components/dash/page";

/**
 * Full paginated notification history for one audience — reached via the
 * bell's "View all notifications" link. Only "important" rows are stored
 * for the bell/history at all (see backend NotificationService); this page
 * doesn't do any further client-side filtering on top of that.
 */
export default function NotificationHistory({ audienceRole, schoolId, userId, title = "Notifications" }) {
  const router = useRouter();
  const attention = useAttention({ enabled: Boolean(audienceRole) });
  const [notifications, setNotifications] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  function load(pageNum) {
    if (!audienceRole) return;
    setLoading(true);

    const params = new URLSearchParams({ audience_role: audienceRole, page: String(pageNum) });
    if (schoolId) params.set("school_id", schoolId);
    if (userId) params.set("user_id", userId);

    apiFetch(`/api/notifications/history?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setNotifications(data.notifications ?? []);
        setTotal(data.total ?? 0);
        setHasMore(Boolean(data.has_more));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceRole, schoolId, userId, page]);

  function handleOpen(notification) {
    if (!notification.read) {
      apiFetch(`/api/notifications/${notification.id}/read`, { method: "POST" }).catch(() => {});
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
    }
    if (notification.link) router.push(notification.link);
  }

  function handleMarkAllRead() {
    const params = { audience_role: audienceRole, school_id: schoolId, user_id: userId };
    apiFetch("/api/notifications/mark-all-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <Page size="narrow" className="mx-0">
      <PageHeader title={title} sentence={`${total} notification${total === 1 ? "" : "s"} in all.`}>
        {hasUnread && <Btn onClick={handleMarkAllRead}>Mark all read</Btn>}
      </PageHeader>

      <AttentionQueue
        title="Needs your attention"
        subtitle="Worked out live from your own data, so it is always up to date. These are not stored notifications."
        items={attention.items}
        loading={attention.loading}
      />

      <Section flush>
        {loading && notifications.length === 0 ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : notifications.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="bell" title="No notifications yet." text="Important updates show up here and in the bell at the top." />
          </div>
        ) : (
          <DataList>
            {notifications.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => handleOpen(n)} className="k-row w-full items-start text-left" style={!n.read ? { background: "var(--ui-info-bg)" } : undefined}>
                  <span className="k-row-main">
                    <span className={`k-row-title ${!n.read ? "font-semibold" : ""}`}>
                      {!n.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600 align-middle" aria-label="Unread" />}
                      {n.title}
                    </span>
                    {n.body && <span className="k-row-sub">{n.body}</span>}
                    <span className="k-row-sub">{n.created_at}</span>
                  </span>
                </button>
              </li>
            ))}
          </DataList>
        )}
        <Pagination page={page} totalPages={totalPages} total={total} loading={loading} onPageChange={setPage} />
      </Section>
    </Page>
  );
}
