"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";
import ShellSkeleton from "@/components/ui/ShellSkeleton";

const navItems = [
  { label: "Dashboard", href: "/superadmin/dashboard", icon: "dashboard" },
  { label: "Schools", href: "/superadmin/schools", icon: "schools" },
  { label: "Inquiries", href: "/superadmin/inquiries", icon: "inquiries" },
  { label: "Billing", href: "/superadmin/billing", icon: "billing" },
  { label: "Plans", href: "/superadmin/plans", icon: "plans" },
  { label: "AI Usage", href: "/superadmin/ai-usage", icon: "ai" },
  { label: "Support", href: "/superadmin/support", icon: "support" },
  { label: "Activity", href: "/superadmin/activity-logs", icon: "activity" },
];

const PROFILE_LINKS = [
  { href: "/superadmin/profile", icon: "user", label: "My Profile" },
  { href: "/superadmin/settings", icon: "settings", label: "Settings" },
];

export default function SuperadminLayout({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem("internova_user") || "null");
    } catch {
      stored = null;
    }

    // No real session at all, or a token for some other role — either way this
    // isn't a Super Admin, so don't render any admin screen or data for them.
    if (!stored || stored.role !== "super_admin") {
      router.replace("/login");
      return;
    }

    setUser(stored);
    setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (checking || !user) return <ShellSkeleton />;


  return (
    <AppShell
      section="Super Admin"
      navItems={navItems}
      user={user}
      onLogout={handleLogout}
      notificationBellProps={{ audienceRole: "superadmin", historyHref: "/superadmin/notifications" }}
      onUserUpdated={handleUserUpdated}
      profileLinks={PROFILE_LINKS}
      fallbackName="Super Admin"
    >
      {children}
    </AppShell>
  );
}
