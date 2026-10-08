"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";

const navItems = [
  { label: "Dashboard", href: "/intern/dashboard", icon: "dashboard" },
  { label: "Attendance", href: "/intern/attendance", icon: "attendance" },
  { label: "Tasks", href: "/intern/tasks", icon: "tasks" },
  { label: "Activities", href: "/intern/activities", icon: "activities" },
  { label: "Evaluations", href: "/intern/evaluations", icon: "evaluations" },
  { label: "Documents", href: "/intern/documents", icon: "documents" },
  { label: "Portfolio", href: "/intern/portfolio", icon: "portfolio" },
];

// Data the intern screens load, fetched ahead so every screen — attendance
// above all — still shows its last data offline (see AppShell warm-up).
const WARM_API = [
  "/api/intern/profile-summary",
  "/api/intern/tasks",
  "/api/intern/attendance/today",
  "/api/intern/attendance",
  "/api/intern/activities",
  "/api/intern/activities/suggestions",
  "/api/intern/evaluations",
  "/api/intern/documents",
  "/api/intern/portfolio",
];

const PROFILE_LINKS = [
  { href: "/intern/profile", icon: "user", label: "My Profile" },
  { href: "/intern/settings", icon: "gear", label: "Settings" },
];

export default function InternLayout({ children }) {
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

    if (!stored || stored.role !== "intern") {
      router.replace("/login");
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

  if (checking || !user) return null;

  return (
    <AppShell
      section="Internship"
      navItems={navItems}
      user={user}
      onLogout={handleLogout}
      notificationBellProps={{ audienceRole: "intern", schoolId: user.school_id, userId: user.id, historyHref: "/intern/notifications" }}
      messengerCurrentUser={user}
      onUserUpdated={handleUserUpdated}
      profileLinks={PROFILE_LINKS}
      fallbackName="Intern"
      warmApi={WARM_API}
    >
      {children}
    </AppShell>
  );
}
