"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import Logo from "@/components/Logo";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeToggle from "@/components/ThemeToggle";
import SubscriptionNotice from "@/components/SubscriptionNotice";
import FeedbackUnreadWatcher from "@/components/FeedbackUnreadWatcher";
import { UserContext } from "@/lib/UserContext";
import { apiFetch } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";

const PROFILE_LINKS = [
  { href: "/coordinator/profile", icon: "user", label: "My Profile" },
  { href: "/coordinator/settings", icon: "gear", label: "Settings" },
  { href: "/coordinator/support", icon: "message", label: "Contact Support" },
];

const BASE_NAV_ITEMS = [
  { label: "Dashboard", href: "/coordinator/dashboard", icon: "dashboard" },
  { label: "Interns", href: "/coordinator/interns", icon: "interns" },
  { label: "Companies", href: "/coordinator/companies", icon: "companies" },
  { label: "Supervisors", href: "/coordinator/supervisors", icon: "supervisors" },
  { label: "Attendance", href: "/coordinator/attendance", icon: "attendance" },
  { label: "Tasks", href: "/coordinator/tasks", icon: "tasks" },
  { label: "Evaluations", href: "/coordinator/evaluations", icon: "evaluations" },
  { label: "Documents", href: "/coordinator/documents", icon: "documents" },
  { label: "Reports", href: "/coordinator/reports", icon: "reports" },
  { label: "Dean Feedback", href: "/coordinator/feedback", icon: "feedback" },
  // Billing and editing school details belong to the school's Dean; this page is read-only here.
  { label: "Settings", href: "/coordinator/settings", icon: "settings" },
];

// Reachable in any access-gate state — small utility screens, not operational data.
const GATE_EXEMPT_ROUTES = ["/coordinator/profile", "/coordinator/account", "/coordinator/notifications", "/coordinator/support"];

const OFFER_PENDING_STATUSES = ["awaiting_acceptance", "accepted", "pending_payment", "offer_expired"];

/**
 * Single source of truth for what a coordinator is allowed to see right now.
 * Hiding sidebar links is not access control — this also drives which route
 * the layout force-redirects to, and the actual data endpoints are gated
 * server-side too. A coordinator never pays: until the school's Dean activates
 * the subscription they wait on /coordinator/subscription-status.
 */
function resolveGate(user) {
  if (!user) return { state: "unauthenticated" };
  if (user.status === "pending_approval") return { state: "pending_approval", target: "/coordinator/pending" };
  if (user.school_suspended) return { state: "suspended", target: "/coordinator/subscription-status" };
  if (user.subscription_status === "expired") return { state: "expired", target: "/coordinator/subscription-status" };
  if (OFFER_PENDING_STATUSES.includes(user.subscription_status)) return { state: "waiting_for_dean", target: "/coordinator/subscription-status" };
  if (user.subscription_status === "active") return { state: "active" };
  // Safe default while we don't yet know the subscription state.
  return { state: "waiting_for_dean", target: "/coordinator/subscription-status" };
}

// Minimal chrome for gated states — just the brand and account menu, no operational nav.
function MinimalTopBar({ user, onLogout }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <Logo size={34} />
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <ProfileMenu user={user} onLogout={onLogout} fallbackName="Coordinator" links={PROFILE_LINKS} />
      </div>
    </header>
  );
}

export default function CoordinatorLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [feedbackUnread, setFeedbackUnread] = useState(0);

  function handleLogout() {
    apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("internova_user");
    localStorage.removeItem("internova_token");
    clearOfflineCaches();
    router.push("/login");
  }

  function handleUserUpdated(updatedUser) {
    setUser(updatedUser);
    try {
      localStorage.setItem("internova_user", JSON.stringify(updatedUser));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem("internova_user") || "null");
    } catch {
      stored = null;
    }

    if (!stored || stored.role !== "coordinator") {
      router.replace("/login");
      return;
    }

    setUser(stored);

    // Re-check against the database instead of trusting the login-time snapshot — a
    // pending applicant may have been approved since, a Super Admin may have suspended
    // the school, or an offer may have expired, all without the coordinator logging out.
    apiFetch(`/api/auth/session/${stored.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        localStorage.setItem("internova_user", JSON.stringify(data.user));
        setUser(data.user);
      })
      .catch(() => {
        // Network hiccup — fall back to the cached snapshot rather than locking the user out.
      })
      .finally(() => setChecking(false));
    // Runs once per layout mount (e.g. fresh login or full reload) — Next.js keeps this
    // layout instance alive across navigations within /coordinator/*, so this isn't
    // re-fetched on every click, only when the coordinator section is first entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gate = resolveGate(user);
  const isExemptRoute = GATE_EXEMPT_ROUTES.includes(pathname);
  const isFullAccess = gate.state === "active";

  useEffect(() => {
    if (checking || gate.state === "unauthenticated") return;

    if (!isFullAccess && !isExemptRoute && pathname !== gate.target) {
      router.replace(gate.target);
      return;
    }

    // Fully active coordinators shouldn't linger on the onboarding-only screens.
    if (isFullAccess && ["/coordinator/pending", "/coordinator/subscription-status"].includes(pathname)) {
      router.replace("/coordinator/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, gate.state, gate.target, pathname, isFullAccess, isExemptRoute]);

  if (checking || !user) return null;

  // Gated states (and the small exempt utility pages within them) get the minimal chrome only.
  if (!isFullAccess) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800">
        <MinimalTopBar user={user} onLogout={handleLogout} />
        <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
          <UserContext.Provider value={{ user, onUserUpdated: handleUserUpdated }}>{children}</UserContext.Provider>
        </main>
      </div>
    );
  }

  return (
    <AppShell
      section="Coordinator"
      navItems={BASE_NAV_ITEMS.map((item) => (item.href === "/coordinator/feedback" ? { ...item, badge: feedbackUnread } : item))}
      user={user}
      onLogout={handleLogout}
      notificationBellProps={{ audienceRole: "coordinator", schoolId: user.school_id, userId: user.id, historyHref: "/coordinator/notifications" }}
      messengerCurrentUser={user}
      onUserUpdated={handleUserUpdated}
      profileLinks={PROFILE_LINKS}
      fallbackName="Coordinator"
    >
      <FeedbackUnreadWatcher onCount={setFeedbackUnread} />
      <SubscriptionNotice />
      {children}
    </AppShell>
  );
}
