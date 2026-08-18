"use client";

import { useEffect } from "react";
import { getEcho } from "@/lib/echo";
import { useCurrentUser } from "@/lib/UserContext";

/**
 * Subscribes to this user's own personal notification channel and calls
 * onEvent whenever a push arrives whose `type` is in `types` — the same
 * "wake up and refetch" signal NotificationBell already listens to (see
 * backend NotificationService/NotificationCreated broadcasting on
 * user.{id}-notifications), reused here so an already-open screen updates
 * itself the moment a supervisor/coordinator changes something relevant,
 * instead of the intern having to reload to find out.
 *
 * `types` should be a stable (module-level) array — it isn't in the effect's
 * dependency list, so passing a fresh array literal on every render still
 * works but re-subscribes needlessly; `onEvent` is read once per mount for
 * the same reason (matches the codebase's existing "run once" effect idiom).
 */
export function useLiveRefresh(types, onEvent) {
  const { user } = useCurrentUser();

  useEffect(() => {
    if (!user?.id) return;
    const echo = getEcho();
    if (!echo) return;

    const channelName = `user.${user.id}-notifications`;
    function handle(payload) {
      if (types.includes(payload.type)) onEvent();
    }

    echo.channel(channelName).listen(".notification.created", handle);
    return () => echo.channel(channelName).stopListening(".notification.created", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}
