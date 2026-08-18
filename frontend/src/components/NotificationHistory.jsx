"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/apiFetch";

/**
 * Full paginated notification history for one audience — reached via the
 * bell's "View all notifications" link. Only "important" rows are stored
 * for the bell/history at all (see backend NotificationService); this page
 * doesn't do any further client-side filtering on top of that.
 */
export default function NotificationHistory({ audienceRole, schoolId, userId, title = "Notifications" }) {
  const router = useRouter();
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{total} notification{total === 1 ? "" : "s"} total</p>
        </div>
        {hasUnread && (
          <button onClick={handleMarkAllRead} className="text-sm font-semibold text-blue-600 hover:underline">
            Mark all read
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No notifications yet.</p>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleOpen(n)}
              className={`block w-full border-b border-slate-100 px-6 py-4 text-left last:border-b-0 hover:bg-slate-50 ${
                !n.read ? "bg-blue-50/40" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm text-slate-900 ${!n.read ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                  {n.body && <p className="mt-1 text-sm text-slate-500">{n.body}</p>}
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                    <Icon name="calendar" size={12} className="shrink-0" />
                    {n.created_at}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
