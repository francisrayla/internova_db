"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "./Logo";
import NotificationBell from "./NotificationBell";
import MessengerWidget from "./MessengerWidget";
import ProfileMenu from "./ProfileMenu";
import { UserContext } from "@/lib/UserContext";

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
  children,
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f5f7f2] text-slate-800 print:bg-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-[#fbfcf9] p-5 print:hidden lg:w-72 lg:border-b-0 lg:border-r">
          <div className="mb-6 flex items-center gap-3">
            <LogoMark size={40} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">
                Internova AI
              </p>
              <h1 className="text-lg font-semibold text-slate-900">Workspace</h1>
            </div>
          </div>

          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            Navigation
          </div>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-blue-100 text-blue-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

        </aside>

        <div className="flex-1">
          <header className="border-b border-slate-200 bg-white/80 backdrop-blur print:hidden">
            <div className="flex items-center justify-between px-5 py-4 sm:px-6 lg:px-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                  {section}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{title}</h2>
                {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
              </div>

              <div className="flex items-center gap-3">
                {notificationBellProps && <NotificationBell {...notificationBellProps} />}
                {messengerCurrentUser && <MessengerWidget currentUser={messengerCurrentUser} />}
                <ProfileMenu user={user} onLogout={onLogout} fallbackName="Intern" links={profileLinks ?? []} />
              </div>
            </div>
          </header>

          <main className="p-5 sm:p-6 lg:p-7 print:p-0">
            <UserContext.Provider value={{ user, onUserUpdated }}>{children}</UserContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
