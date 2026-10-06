"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import FeedbackUnreadWatcher from "@/components/FeedbackUnreadWatcher";
import Logo from "@/components/Logo";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { UserContext } from "@/lib/UserContext";
import { apiFetch } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";
import { readStoredUser } from "@/lib/roleDashboard";

const PROFILE_LINKS = [
  { href: "/dean/profile", icon: "user", label: "My Profile" },
  { href: "/dean/account", icon: "gear", label: "Account Settings" },
  { href: "/dean/support", icon: "message", label: "Contact Support" },
];

const NAV_ITEMS = [
  { label: "Overview", href: "/dean/dashboard", icon: "▣" },
  { label: "Coordinator", href: "/dean/coordinator", icon: "🧑‍🏫" },
  { label: "Interns", href: "/dean/interns", icon: "👥" },
  { label: "Billing", href: "/dean/billing", icon: "💳" },
  { label: "School Settings", href: "/dean/settings", icon: "⚙️" },
];

// Reachable before the subscription is active — billing itself plus small utility screens.
const GATE_EXEMPT_ROUTES = ["/dean/billing", "/dean/preview", "/dean/profile", "/dean/account", "/dean/notifications", "/dean/support"];

/**
 * What a dean may see right now. Until the school's subscription is active
 * they only reach billing (accept the offer, pay) — the same lock coordinators
 * used to be under. The billing endpoints are enforced server-side regardless.
 */
function resolveGate(user) {
  if (!user) return { state: "unauthenticated" };
  if (user.status === "pending_approval") return { state: "pending_approval", target: "/dean/pending" };
  if (user.subscription_status === "active") return { state: "active" };
  return { state: "billing_gate", target: "/dean/billing" };
}

// Minimal chrome for gated states — just the brand and account menu, no nav.
function MinimalTopBar({ user, onLogout }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <Logo size={34} />
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <ProfileMenu user={user} onLogout={onLogout} fallbackName="Dean" links={PROFILE_LINKS} />
      </div>
    </header>
  );
}

export default function DeanLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  // Read once from the cached session; the layout renders nothing until the re-check below finishes.
  const [user, setUser] = useState(readStoredUser);
  const [feedbackUnread, setFeedbackUnread] = useState(0);
  const [checking, setChecking] = useState(true);

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
    const stored = readStoredUser();

    if (!stored || stored.role !== "dean") {
      router.replace("/login");
      return;
    }

    // Re-check against the database instead of trusting the login-time snapshot —
    // the registration may have been approved or the subscription changed since.
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
    // Runs once per layout mount; Next.js keeps this layout alive across /dean/* navigations.
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

    if (isFullAccess && pathname === "/dean/pending") {
      router.replace("/dean/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, gate.state, gate.target, pathname, isFullAccess, isExemptRoute]);

  if (checking || !user) return null;

  // Billing is part of the normal nav once active, so only gated states use the minimal chrome.
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
      section="Dean"
      navItems={NAV_ITEMS.map((item) => (item.href === "/dean/coordinator" ? { ...item, badge: feedbackUnread } : item))}
      user={user}
      onLogout={handleLogout}
      notificationBellProps={{ audienceRole: "dean", schoolId: user.school_id, userId: user.id, historyHref: "/dean/notifications" }}
      onUserUpdated={handleUserUpdated}
      profileLinks={PROFILE_LINKS}
      fallbackName="Dean"
    >
      <FeedbackUnreadWatcher role="dean" onCount={setFeedbackUnread} />
      {children}
    </AppShell>
  );
}
