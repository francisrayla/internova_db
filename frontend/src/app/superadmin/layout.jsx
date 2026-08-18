"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import Icon from "@/components/Icon";
import NotificationBell from "@/components/NotificationBell";
import ProfileMenu from "@/components/ProfileMenu";
import { UserContext } from "@/lib/UserContext";
import { apiFetch } from "@/lib/apiFetch";

const navItems = [
  { label: "Dashboard", href: "/superadmin/dashboard", icon: "grid" },
  { label: "Schools", href: "/superadmin/schools", icon: "building" },
  { label: "Inquiries", href: "/superadmin/inquiries", icon: "file" },
  { label: "Billing", href: "/superadmin/billing", icon: "card" },
  { label: "Plans", href: "/superadmin/plans", icon: "list" },
  { label: "AI Usage", href: "/superadmin/ai-usage", icon: "spark" },
  { label: "Support", href: "/superadmin/support", icon: "message" },
  { label: "Activity", href: "/superadmin/activity-logs", icon: "calendar" },
];

const PROFILE_LINKS = [
  { href: "/superadmin/profile", icon: "user", label: "My Profile" },
  { href: "/superadmin/account", icon: "gear", label: "Account Settings" },
  { href: "/superadmin/system-settings", icon: "list", label: "System Settings" },
];

export default function SuperadminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const navRef = useRef(null);

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

  useEffect(() => {
    function handleClickOutside(event) {
      if (navRef.current && !navRef.current.contains(event.target)) setMobileNavOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLogout() {
    apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("internova_user");
    localStorage.removeItem("internova_token");
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

  if (checking || !user) return null;

  const currentLabel = navItems.find((item) => item.href === pathname)?.label ?? "Super Admin";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        <aside
          ref={navRef}
          className="flex w-full flex-col border-b border-slate-200 bg-white/90 lg:w-auto lg:border-b-0 lg:border-r"
        >
          <div className="flex items-center justify-between px-3 py-3 lg:py-6">
            <button
              type="button"
              onClick={() => {
                // One control, two jobs: below lg it opens/closes the dropdown
                // (nav is hidden by default on small screens), at lg+ it
                // collapses the sidebar to icons-only. Each class only takes
                // effect at its own breakpoint, so toggling both is harmless.
                setMobileNavOpen((v) => !v);
                setCollapsed((v) => !v);
              }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex shrink-0 items-center rounded-xl px-1.5 py-1.5 hover:bg-slate-100"
            >
              <Logo size={42} wordmark={!collapsed} className="shrink-0" />
            </button>
            <Icon
              name="chevronDown"
              size={16}
              className={`text-slate-400 transition-transform lg:hidden ${mobileNavOpen ? "rotate-180" : ""}`}
            />
          </div>

          <nav
            className={`flex-col gap-1.5 px-3 pb-3 lg:flex lg:pb-6 lg:pt-0 ${mobileNavOpen ? "flex" : "hidden"} ${
              collapsed ? "lg:w-20" : "lg:w-60"
            }`}
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                    collapsed ? "lg:justify-center" : ""
                  } ${
                    isActive ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <Icon name={item.icon} size={18} className="shrink-0" />
                  <span className={`text-sm font-medium whitespace-nowrap ${collapsed ? "lg:hidden" : ""}`}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Super Admin</p>
              <h2 className="text-lg font-semibold text-slate-900">{currentLabel}</h2>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell audienceRole="superadmin" historyHref="/superadmin/notifications" />
              <ProfileMenu user={user} onLogout={handleLogout} fallbackName="Super Admin" links={PROFILE_LINKS} />
            </div>
          </header>

          <main className="p-6 lg:p-8">
            <UserContext.Provider value={{ user, onUserUpdated: handleUserUpdated }}>{children}</UserContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
