"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch, loginPath } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";
import ShellSkeleton from "@/components/ui/ShellSkeleton";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/supervisor/dashboard", icon: "dashboard" },
  { label: "Interns", href: "/supervisor/interns", icon: "interns" },
  { label: "Attendance", href: "/supervisor/attendance", icon: "attendance" },
  { label: "Activities", href: "/supervisor/activities", icon: "activities" },
  { label: "Tasks", href: "/supervisor/tasks", icon: "tasks" },
  { label: "Evaluations", href: "/supervisor/evaluations", icon: "evaluations" },
  { label: "Certificates", href: "/supervisor/certificates", icon: "certificates" },
  // "Files" (/supervisor/files) is a placeholder page for now; add it back here when it is built.
];

const PROFILE_LINKS = [
  { href: "/supervisor/profile", icon: "user", label: "My Profile" },
  { href: "/supervisor/settings", icon: "settings", label: "Settings" },
];

export default function SupervisorLayout({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
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
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem("internova_user") || "null");
    } catch {
      stored = null;
    }

    if (!stored || stored.role !== "supervisor") {
      router.replace(loginPath());
      return;
    }

    setUser(stored);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking || !user) return <ShellSkeleton />;


  return (
    <AppShell
      section="Supervisor"
      navItems={NAV_ITEMS}
      user={user}
      onLogout={handleLogout}
      notificationBellProps={{ audienceRole: "supervisor", schoolId: user.school_id, userId: user.id, historyHref: "/supervisor/notifications" }}
      messengerCurrentUser={user}
      onUserUpdated={handleUserUpdated}
      profileLinks={PROFILE_LINKS}
      fallbackName="Supervisor"
    >
      {children}
    </AppShell>
  );
}
