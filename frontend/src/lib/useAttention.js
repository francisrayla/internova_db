"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

const REFRESH_MS = 120000;

/**
 * The signed-in person's live "Needs your attention" list (GET /api/notifications/attention).
 * The server decides whose list it is from the login token; nothing about role, school or user is sent.
 * Reloads by itself every two minutes while the tab is visible, and whenever `reload()` is called
 * (the bell does that when it opens and when a live notification arrives).
 *
 * Returns { items, badge, loading, reload }. `badge` counts only the items that need an action.
 */
export function useAttention({ enabled = true } = {}) {
  const [state, setState] = useState({ items: [], badge: 0, loading: true });
  const alive = useRef(true);

  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return apiFetch("/api/notifications/attention")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("attention"))))
      .then((data) => {
        if (alive.current) setState({ items: data.items ?? [], badge: data.badge ?? 0, loading: false });
      })
      .catch(() => {
        // The bell just keeps what it had; a failed to-do list is never an error screen.
        if (alive.current) setState((prev) => ({ ...prev, loading: false }));
      });
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    reload();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [reload]);

  return { ...state, reload };
}
