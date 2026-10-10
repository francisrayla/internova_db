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

const SCHOOL_GATE_CODES = ["school_suspended", "subscription_expired", "subscription_unpaid"];

/** Clears the stored session and sends the user to /login (with a note on why, when we know). */
function endSession(reason) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
  clearOfflineCaches();
  if (window.location.pathname !== "/login") {
    window.location.href = reason ? `/login?reason=${reason}` : "/login";
  }
}

/**
 * The API answers 403 { code } when the signed-in user's school is suspended or its subscription
 * lapsed (EnsureSchoolAccess). The session stays; the user goes to the page that explains it:
 * coordinators to their subscription-status page, a Dean to Billing (to renew) when it is a
 * subscription problem, everyone else to /school-access.
 */
function sendToSchoolGate(code) {
  let role = null;
  try {
    role = JSON.parse(localStorage.getItem(USER_KEY) || "null")?.role ?? null;
  } catch {
    // ignore
  }

  const reason = code === "school_suspended" ? "suspended" : code === "subscription_expired" ? "expired" : "unpaid";
  let target = `/school-access?reason=${reason}`;
  if (role === "coordinator") target = "/coordinator/subscription-status";
  else if (role === "dean" && reason !== "suspended") target = "/dean/billing";

  const path = window.location.pathname;
  if (path === target.split("?")[0] || path.startsWith("/school-access")) return;
  window.location.href = target;
}

/**
 * Drop-in replacement for fetch() against our own /api/* proxy routes —
 * attaches the signed-in user's token and, if the backend rejects it with 401
 * (expired, revoked by a fresh login elsewhere, or never logged in),
 * clears the stale session and sends the user back to /login instead of
 * letting the screen silently render empty/broken data. 403 never logs out.
 */
export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });

  // Only 401 means "this session is over" (expired after 7 days, revoked by a fresh login
  // elsewhere, or never signed in). A 403 is "you may not do this" — a wrong role, or the
  // school being suspended / unpaid — and must NOT sign anyone out: the caller shows the
  // server's message, and the school gates below send the user to the right page.
  if (response.status === 401 && typeof window !== "undefined") {
    endSession(token ? "expired" : null);
  }

  if (response.status === 403 && typeof window !== "undefined") {
    const body = await response.clone().json().catch(() => null);
    if (body?.code && SCHOOL_GATE_CODES.includes(body.code)) {
      sendToSchoolGate(body.code);
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

/**
 * GET a JSON resource from one of the per-role proxies (/api/<prefix>/<path>),
 * throwing with the backend's message when the request fails. The
 * fetch<Role>Data helpers are thin aliases of this.
 */
export async function fetchApiData(prefix, path) {
  const response = await apiFetch(`/api/${prefix}/${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    // Never show the request path or a raw server body to the user: a 4xx with a message from the
    // API is shown as is, anything else (500, backend down, HTML error page) gets one plain sentence.
    const raw = await response.text().catch(() => "");
    let apiMessage = "";
    try {
      apiMessage = JSON.parse(raw)?.message || "";
    } catch {
      apiMessage = "";
    }
    throw new Error(apiMessage && response.status < 500 ? apiMessage : "We couldn't load this right now. Check your connection and try again.");
  }

  return response.json();
}
