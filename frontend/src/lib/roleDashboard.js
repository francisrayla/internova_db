// Shared by the landing page and login page — both need to know where a
// logged-in user actually belongs. A coordinator is a special case: their
// own dashboard is gated behind admin approval and an active subscription,
// so they land on whichever step they're actually blocked at instead.
const ROLE_DASHBOARD = {
  super_admin: "/superadmin/dashboard",
  coordinator: "/coordinator/dashboard",
  supervisor: "/supervisor/dashboard",
  intern: "/intern/dashboard",
};

export function resolveDashboardPath(user) {
  if (!user) return null;

  if (user.role === "coordinator") {
    if (user.status === "pending_approval") return "/coordinator/pending";
    if (user.subscription_status !== "active") return "/coordinator/subscription";
    return "/coordinator/dashboard";
  }

  return ROLE_DASHBOARD[user.role] ?? null;
}

/** Reads the cached session from localStorage — null if there isn't one or
 * it's unparseable. Doesn't verify the token is still valid server-side;
 * callers that land on a real dashboard already re-check that themselves. */
export function readStoredUser() {
  if (typeof window === "undefined") return null;
  try {
    const token = localStorage.getItem("internova_token");
    if (!token) return null;
    return JSON.parse(localStorage.getItem("internova_user") || "null");
  } catch {
    return null;
  }
}
