"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEcho } from "@/lib/echo";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/apiFetch";
import { useAttention } from "@/lib/useAttention";
import AttentionQueue from "@/components/AttentionQueue";

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
  // The red number: only what arrived since the list was last opened (see markSeen on the server).
  const [newCount, setNewCount] = useState(0);
  // "Needs your attention": a live to-do list worked out by the server for the signed-in person only.
  const attention = useAttention({ enabled: Boolean(audienceRole) });
  const reloadAttention = attention.reload;
  const rootRef = useRef(null);
  const openRef = useRef(false);
  // Red number = notifications that arrived since the bell was last opened + things that still need an action.
  const badge = newCount + attention.badge;

  function markSeen() {
    apiFetch("/api/notifications/seen", { method: "POST" }).catch(() => {});
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        openRef.current = false;
        setOpen(false);
      }
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
          setNewCount(data.new_count ?? data.unread_count ?? 0);
        }
      })
      .catch(() => {
        // No notifications yet / server hiccup — bell just stays empty.
      });

    const echo = getEcho();
    if (!echo) return;

    const channelNames =
      audienceRole === "superadmin"
        ? ["superadmin.notifications"]
        : [...(schoolId ? [`school.${schoolId}.${audienceRole}.notifications`] : []), ...(userId ? [`user.${userId}.notifications`] : [])];

    function handlePush(payload) {
      // Non-important rows exist only to wake up live-refresh listeners
      // elsewhere on the page — they shouldn't clutter the bell itself.
      if (payload.important === false) return;
      setNotifications((prev) => [{ ...payload, read: false }, ...prev].slice(0, 30));
      setUnreadCount((prev) => prev + 1);
      // Already looking at the list: nothing "new" to announce, but remember it was seen.
      if (openRef.current) markSeen();
      else setNewCount((prev) => prev + 1);
      // Whatever just happened may have added to or cleared the to-do list.
      reloadAttention();
    }

    channelNames.forEach((name) => echo.private(name).listen(".notification.created", handlePush));

    return () => {
      // Other screens (Schools/Billing/Plans) subscribe to this same public
      // channel for their own live-refresh — echo.leave() would tear the
      // whole channel down for them too. Removing only this listener keeps
      // the shared subscription alive for whoever else is still using it.
      channelNames.forEach((name) => echo.private(name).stopListening(".notification.created", handlePush));
    };
  }, [audienceRole, schoolId, userId, reloadAttention]);

  function toggleOpen() {
    const next = !open;
    openRef.current = next;
    setOpen(next);
    if (next) reloadAttention();
    if (next && newCount > 0) {
      setNewCount(0);
      markSeen();
    }
  }

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
    setNewCount(0);
    markSeen();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 max-sm:h-[44px] max-sm:w-[44px]"
        title="Notifications"
        aria-label={badge > 0 ? `Notifications, ${badge} to look at` : "Notifications"}
        aria-expanded={open}
      >
        <Icon name="bell" size={18} />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        // Phones: pinned under the header, edge to edge with a margin — the
        // bell sits mid-row there, so a 320px panel anchored to it would run
        // off the left of the screen. From sm up it hangs off the bell again.
        <div className="fixed inset-x-3 top-16 z-30 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications &amp; to-do</p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs font-semibold text-blue-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <AttentionQueue compact items={attention.items} loading={attention.loading} onNavigate={() => { openRef.current = false; setOpen(false); }} />
            <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Notifications</p>
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
                      <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-400">
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
              className="block w-full shrink-0 border-t border-slate-100 px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-slate-50"
            >
              View all notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}
