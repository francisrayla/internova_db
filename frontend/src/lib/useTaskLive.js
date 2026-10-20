"use client";

import { useEffect, useRef } from "react";
import { getEcho } from "@/lib/echo";
import { useCurrentUser } from "@/lib/UserContext";

const DEBOUNCE_MS = 400;

/**
 * Live task screens: calls onChange(taskIds) when someone else (or this user on another device)
 * changes a task this user can see — a subtask moved to Ongoing, marked Done, a proof, a comment,
 * a rating, an edit. The backend (App\Services\TaskLiveUpdates) pushes "task.changed" with only the
 * task id on the private channel user.{id}.tasks; the screen then refetches through the normal API.
 *
 * Several pushes in a row (one request can touch a subtask and its task) are folded into one call.
 * Before the screen refetches, the service worker is told to answer from the network, not its saved
 * copy, so the reload never shows the state from before the change.
 */
export function useTaskLive(onChange) {
  const { user } = useCurrentUser();
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    if (!user?.id) return;
    const echo = getEcho();
    if (!echo) return;

    const channelName = `user.${user.id}.tasks`;
    let timer = null;
    let ids = new Set();

    function handle(payload) {
      const id = Number(payload?.task_id);
      if (id) ids.add(id);
      try {
        navigator.serviceWorker?.controller?.postMessage({ type: "FRESH_READS" });
      } catch {
        // no service worker (dev, or not installed yet): reads already go to the network
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = ids;
        ids = new Set();
        handler.current?.(changed);
      }, DEBOUNCE_MS);
    }

    echo.private(channelName).listen(".task.changed", handle);
    return () => {
      clearTimeout(timer);
      echo.private(channelName).stopListening(".task.changed", handle);
    };
  }, [user?.id]);
}
