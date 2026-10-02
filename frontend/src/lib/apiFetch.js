"use client";

import { clearOfflineCaches } from "@/lib/offlineCache";

const TOKEN_KEY = "internova_token";
const USER_KEY = "internova_user";

function getToken() {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Drop-in replacement for fetch() against our own /api/* proxy routes —
 * attaches the signed-in user's token and, if the backend ever rejects it
 * (expired, revoked by a fresh login elsewhere, or never logged in),
 * clears the stale session and sends the user back to /login instead of
 * letting the screen silently render empty/broken data.
 */
export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });

  // 403 is included alongside 401 because this app's EnsureRole middleware
  // returns 403 "Forbidden." both for a genuine role mismatch and for a
  // token whose user no longer resolves (e.g. the account was recreated) —
  // in a single-role-per-session SPA like this one, either case means the
  // stored session is stale and the only way forward is a fresh login.
  if ((response.status === 401 || response.status === 403) && typeof window !== "undefined") {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    clearOfflineCaches();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  // A 503 from EnforceMaintenanceMode means every other screen's own fetch
  // would otherwise show its own generic error banner — sending everyone to
  // one dedicated page instead is what actually makes maintenance mode read
  // as "the platform is down for a reason," not "the app is broken."
  if (response.status === 503 && typeof window !== "undefined" && window.location.pathname !== "/maintenance") {
    const clone = response.clone();
    const body = await clone.json().catch(() => null);
    if (body?.maintenance) {
      window.location.href = "/maintenance";
    }
  }

  return response;
}
