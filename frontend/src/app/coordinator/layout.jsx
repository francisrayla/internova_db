"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import Icon from "@/components/Icon";
import NotificationBell from "@/components/NotificationBell";
import MessengerWidget from "@/components/MessengerWidget";
import SubscriptionNotice from "@/components/SubscriptionNotice";
import ProfileMenu from "@/components/ProfileMenu";
import { UserContext } from "@/lib/UserContext";
import { apiFetch } from "@/lib/apiFetch";

const PROFILE_LINKS = [
  { href: "/coordinator/profile", icon: "user", label: "My Profile" },
  { href: "/coordinator/account", icon: "gear", label: "Account Settings" },
  { href: "/coordinator/support", icon: "message", label: "Contact Support" },
];

const BASE_NAV_ITEMS = [
  { label: "Dashboard", href: "/coordinator/dashboard", icon: "grid" },
  { label: "Interns", href: "/coordinator/interns", icon: "users" },
  { label: "Companies", href: "/coordinator/companies", icon: "building" },
  { label: "Attendance", href: "/coordinator/attendance", icon: "calendar" },
  { label: "Tasks", href: "/coordinator/tasks", icon: "check" },
  { label: "Evaluations", href: "/coordinator/evaluations", icon: "spark" },
  { label: "Documents", href: "/coordinator/documents", icon: "file" },
  { label: "Reports", href: "/coordinator/reports", icon: "list" },
];

// Only the school's primary coordinator handles billing/account settings —
// additional coordinators only see internship operations.
const PRIMARY_ONLY_NAV_ITEMS = [
  { label: "Billing", href: "/coordinator/subscription", icon: "card" },
  { label: "School Settings", href: "/coordinator/settings", icon: "gear" },
];

// Reachable in any access-gate state — small utility screens, not operational data.
const GATE_EXEMPT_ROUTES = ["/coordinator/preview", "/coordinator/profile", "/coordinator/account", "/coordinator/notifications", "/coordinator/support"];

const OFFER_PENDING_STATUSES = ["awaiting_acceptance", "accepted", "pending_payment", "offer_expired"];

/**
 * Single source of truth for what a coordinator is allowed to see right now.
 * Hiding sidebar links is not access control — this also drives which route
 * the layout force-redirects to, and the actual data endpoints are gated
 * server-side too (see CoordinatorSubscriptionController).
 */
function resolveGate(user) {
  if (!user) return { state: "unauthenticated" };
  if (user.status === "pending_approval") return { state: "pending_approval", target: "/coordinator/pending" };
  if (user.school_suspended) return { state: "suspended", target: "/coordinator/subscription-status" };
  if (user.subscription_status === "expired") return { state: "expired", target: "/coordinator/subscription-status" };
  if (OFFER_PENDING_STATUSES.includes(user.subscription_status)) return { state: "billing_gate", target: "/coordinator/subscription" };
  if (user.subscription_status === "active") return { state: "active" };
  // Safe default while we don't yet know the subscription state.
  return { state: "billing_gate", target: "/coordinator/subscription" };
}

// Minimal chrome for gated states — just the brand and account menu, no operational nav.
function MinimalTopBar({ user, onLogout }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <Logo size={34} />
      <div className="flex items-center gap-3">
        <ProfileMenu user={user} onLogout={onLogout} fallbackName="Coordinator" links={PROFILE_LINKS} />
      </div>
    </header>
  );
}

export default function CoordinatorLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const navRef = useRef(null);

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

  useEffect(() => {
    function handleClickOutside(event) {
      if (navRef.current && !navRef.current.contains(event.target)) setMobileNavOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        <main className="mx-auto max-w-5xl p-6 lg:p-8">
          <UserContext.Provider value={{ user, onUserUpdated: handleUserUpdated }}>{children}</UserContext.Provider>
        </main>
      </div>
    );
  }

  const isPrimary = Boolean(user.is_primary_coordinator);
  const navItems = isPrimary ? [...BASE_NAV_ITEMS, ...PRIMARY_ONLY_NAV_ITEMS] : BASE_NAV_ITEMS;
  // Exact match first (e.g. /coordinator/companies), then longest-prefix match so a
  // nested detail route (e.g. /coordinator/companies/3) still shows its section's label.
  const currentLabel = (
    navItems.find((item) => item.href === pathname) ??
    navItems
      .filter((item) => pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]
  )?.label ?? "Coordinator";

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
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Coordinator</p>
              <h2 className="text-lg font-semibold text-slate-900">{currentLabel}</h2>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell
                audienceRole="coordinator"
                schoolId={user?.school_id}
                userId={user?.id}
                historyHref="/coordinator/notifications"
              />
              <MessengerWidget currentUser={user} />
              <ProfileMenu user={user} onLogout={handleLogout} fallbackName="Coordinator" links={PROFILE_LINKS} />
            </div>
          </header>

          <main className="p-6 lg:p-8">
            {!isPrimary && <SubscriptionNotice />}
            <UserContext.Provider value={{ user, onUserUpdated: handleUserUpdated }}>{children}</UserContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
