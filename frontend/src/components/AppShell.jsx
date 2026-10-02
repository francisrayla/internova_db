"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "./Logo";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import MessengerWidget from "./MessengerWidget";
import ProfileMenu from "./ProfileMenu";
import ThemeToggle from "./ThemeToggle";
import InstallAppButton from "./InstallAppButton";
import OfflineStatus from "./OfflineStatus";
import { UserContext } from "@/lib/UserContext";
import { syncTrustedClock } from "@/lib/trustedClock";

// Names the current page from the sidebar and profile-menu links (exact
// match first, then the longest prefix so /x/tasks/12 still reads "Tasks").
// Pages linked from neither (Notifications, Super Admin's Companies/Users)
// fall back to their own path segment instead of the role name.
function resolveTitle(pathname, items, section) {
  const exact = items.find((item) => item.href === pathname);
  if (exact) return exact.label;
  const prefix = items
    .filter((item) => pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (prefix) return prefix.label;
  const segment = pathname.split("/").filter((part) => part && !/^\d+$/.test(part)).pop();
  if (!segment) return section;
  return segment.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export default function AppShell({
  title,
  subtitle,
  section,
  navItems,
  user,
  onLogout,
  notificationBellProps,
  messengerCurrentUser,
  onUserUpdated,
  profileLinks,
  fallbackName = "User",
  warmApi,
  children,
}) {
  const pathname = usePathname();
  const pageTitle = title ?? resolveTitle(pathname, [...navItems, ...(profileLinks ?? [])], section);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef(null);

  // Desktop-only — remembered across reloads so it doesn't snap back to
  // expanded every time. Mobile always uses the full drawer from
  // mobileNavOpen instead, so this never applies there.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("internova_sidebar_collapsed") === "1");
    } catch {
      // ignore
    }
  }, []);

  function toggleCollapsed() {
    // The logo button that triggers this is also visible (unstyled by the
    // collapse classes) below lg — guard here so a mobile tap on it doesn't
    // silently flip the desktop preference in the background.
    if (typeof window !== "undefined" && window.innerWidth < 1024) return;
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("internova_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Offline readiness: whenever the app is open with a connection, have the
  // service worker store every screen in this menu (and the data in warmApi)
  // so each one still opens offline — not just the screens visited on this
  // device. Repeats after an app update (controllerchange) and on reconnect.
  const warmKey = [...navItems, ...(profileLinks ?? [])].map((item) => item.href).join("|");
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const pages = warmKey.split("|");
    function warm() {
      if (!navigator.onLine) return;
      // Anchor the attendance clock to the server while there's a connection.
      syncTrustedClock();
      navigator.serviceWorker.ready
        .then((registration) => registration.active?.postMessage({ type: "WARM_PAGES", urls: pages }))
        .catch(() => {});
      // Plain fetch, not apiFetch: a refused warm-up request must never log
      // the user out. The service worker caches whatever succeeds.
      let token = null;
      try { token = localStorage.getItem("internova_token"); } catch { /* ignore */ }
      if (!token) return;
      for (const path of warmApi ?? []) {
        fetch(path, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } }).catch(() => {});
      }
    }
    const timer = setTimeout(warm, 3000);
    navigator.serviceWorker.addEventListener("controllerchange", warm);
    window.addEventListener("online", warm);
    return () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", warm);
      window.removeEventListener("online", warm);
    };
  }, [warmKey, warmApi]);

  // Same click-outside-closes and route-change-closes behavior the other
  // three roles' layouts already use — kept consistent here rather than
  // inventing a different mobile-nav pattern just for interns.
  useEffect(() => {
    function handleClickOutside(event) {
      if (navRef.current && !navRef.current.contains(event.target)) setMobileNavOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f7f2] text-slate-800 print:bg-white lg:h-screen lg:overflow-hidden print:h-auto print:overflow-visible">
      <div className="flex min-h-screen flex-col lg:h-full lg:flex-row">
        {/* Backdrop — dims and blocks the rest of the screen while the
            drawer is open, and doubles as a tap-to-close target. */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 print:hidden lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          ref={navRef}
          className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r border-slate-200 bg-[#fbfcf9] transition-[transform,width] duration-200 ease-out print:hidden lg:static lg:z-auto lg:h-full lg:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          } ${collapsed ? "lg:w-20" : "lg:w-72"}`}
        >
          <div className={`flex items-center p-5 lg:pb-3 ${collapsed ? "lg:justify-center" : "justify-between"}`}>
            {/* Desktop: the logo itself is the collapse/expand toggle — no
                separate button. Mobile keeps the drawer as a plain brand
                mark, since collapsing doesn't apply there. */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex items-center gap-3 rounded-xl lg:hover:bg-slate-100 lg:-m-1.5 lg:p-1.5"
            >
              <LogoMark size={40} />
              <div className={collapsed ? "lg:hidden" : ""}>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">
                  Internova
                </p>
                <h1 className="text-lg font-semibold text-slate-900">Workspace</h1>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            >
              <Icon name="x" size={22} />
            </button>
          </div>

          <div className={collapsed ? "lg:px-2 lg:pb-5" : "px-5 pb-5"}>
            <div className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500 ${collapsed ? "lg:hidden" : ""}`}>
              Navigation
            </div>
            <nav className="space-y-1.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? "bg-blue-100 text-blue-800"
                        : "text-slate-700 hover:bg-slate-100"
                    } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
                  >
                    <span>{item.icon}</span>
                    <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Phone header only has room for the essentials (alerts, chat,
              account), so appearance and app-install live in the drawer there. */}
          <div className="mx-5 mb-5 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 lg:hidden">
            <span className="text-sm font-medium text-slate-700">Appearance</span>
            <div className="flex items-center gap-2">
              <InstallAppButton iconOnly />
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-hidden">
          {/* One bar on phones: menu, page title, and the three controls
              people reach for constantly. Sticky so they never scroll away. */}
          <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden lg:static">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-4 lg:px-7">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={mobileNavOpen}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"
                >
                  <Icon name="menu" size={22} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:tracking-[0.25em]">
                    {section}
                  </p>
                  <h2 className="truncate text-base font-semibold text-slate-900 sm:mt-1 sm:text-lg">{pageTitle}</h2>
                  {subtitle ? <p className="mt-1 hidden text-sm text-slate-600 sm:block">{subtitle}</p> : null}
                </div>
              </div>

              {/* justify-end keeps ProfileMenu's dropdown (right-0 off its own
                  trigger) anchored to the screen's right edge. */}
              <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-3">
                <InstallAppButton iconOnly className="hidden sm:grid" />
                <div className="hidden sm:block">
                  <ThemeToggle />
                </div>
                {notificationBellProps && <NotificationBell {...notificationBellProps} />}
                {messengerCurrentUser && <MessengerWidget currentUser={messengerCurrentUser} />}
                <ProfileMenu user={user} onLogout={onLogout} fallbackName={fallbackName} links={profileLinks ?? []} />
              </div>
            </div>
          </header>

          <main className="min-w-0 px-4 py-5 sm:p-6 lg:flex-1 lg:overflow-y-auto lg:p-7 print:p-0">
            <div className="mb-5 empty:hidden">
              <OfflineStatus />
            </div>
            <UserContext.Provider value={{ user, onUserUpdated }}>{children}</UserContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
