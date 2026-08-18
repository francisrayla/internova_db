"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEcho } from "@/lib/echo";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/apiFetch";

/**
 * Live notification bell — wires up per audience:
 *  - audienceRole="superadmin" -> platform-wide channel
 *  - audienceRole="coordinator"|"supervisor"|"intern" + schoolId -> that school's channel
 *  - + userId also subscribes to a personal channel for that one user
 * See backend App\Events\NotificationCreated for the matching channel names.
 */
export default function NotificationBell({ audienceRole, schoolId, userId, historyHref }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!audienceRole) return;

    const params = new URLSearchParams({ audience_role: audienceRole });
    if (schoolId) params.set("school_id", schoolId);
    if (userId) params.set("user_id", userId);

    apiFetch(`/api/notifications?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.notifications) {
          setNotifications(data.notifications);
          setUnreadCount(data.unread_count ?? 0);
        }
      })
      .catch(() => {
        // No notifications yet / server hiccup — bell just stays empty.
      });

    const echo = getEcho();
    if (!echo) return;

    const channelNames =
      audienceRole === "superadmin"
        ? ["superadmin-notifications"]
        : [`school.${schoolId}.${audienceRole}-notifications`, ...(userId ? [`user.${userId}-notifications`] : [])];

    function handlePush(payload) {
      // Non-important rows exist only to wake up live-refresh listeners
      // elsewhere on the page — they shouldn't clutter the bell itself.
      if (payload.important === false) return;
      setNotifications((prev) => [{ ...payload, read: false }, ...prev].slice(0, 30));
      setUnreadCount((prev) => prev + 1);
    }

    channelNames.forEach((name) => echo.channel(name).listen(".notification.created", handlePush));

    return () => {
      // Other screens (Schools/Billing/Plans) subscribe to this same public
      // channel for their own live-refresh — echo.leave() would tear the
      // whole channel down for them too. Removing only this listener keeps
      // the shared subscription alive for whoever else is still using it.
      channelNames.forEach((name) => echo.channel(name).stopListening(".notification.created", handlePush));
    };
  }, [audienceRole, schoolId, userId]);

  function handleOpenNotification(notification) {
    setOpen(false);
    if (!notification.read) {
      apiFetch(`/api/notifications/${notification.id}/read`, { method: "POST" }).catch(() => {});
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
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
    setUnreadCount(0);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
        title="Notifications"
      >
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs font-semibold text-blue-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications yet</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleOpenNotification(n)}
                  className={`block w-full border-b border-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-50 ${!n.read ? "bg-blue-50/50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                    <div className="min-w-0">
                      <p className={`text-slate-900 ${!n.read ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                      {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-400">
                        <Icon name="calendar" size={11} className="shrink-0" />
                        {n.created_at}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          {historyHref && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(historyHref);
              }}
              className="block w-full rounded-b-2xl border-t border-slate-100 px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-slate-50"
            >
              View all notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}
