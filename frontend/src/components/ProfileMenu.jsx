"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";
import NavIcon from "@/components/NavIcon";
import { useMounted } from "@/lib/useMounted";
import { initialsOf } from "@/lib/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

/**
 * The single header account menu used by every role — avatar/name trigger,
 * click-outside-to-close dropdown with a role-specific set of links (My
 * Profile, Account Settings, etc. — each role passes its own) and a shared
 * Log Out action at the bottom. Previously each layout hand-rolled a near-
 * identical copy of this; consolidated here so behavior/styling never drifts
 * between roles and a 4th (intern) copy didn't have to be written from scratch.
 */
export default function ProfileMenu({ user, onLogout, fallbackName, links = [] }) {
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const rootRef = useRef(null);
  const pathname = usePathname();
  // A link counts as current on its own page and on pages below it (/x/settings/school).
  const isCurrent = (href) => pathname === href || pathname.startsWith(`${href}/`);
  const onAccountPage = links.some((l) => isCurrent(l.href));

  // Portals to <body> for the same reason MessengerWidget's floating windows
  // do — the header this menu lives in has backdrop-blur, which makes it a
  // containing block for position:fixed descendants, so a centered overlay
  // rendered inline here would anchor to the header instead of the viewport.
  const mounted = useMounted();

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initials = initialsOf(user?.name, fallbackName);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 max-sm:min-h-[44px] ${
          onAccountPage ? "border-blue-300 bg-blue-50 hover:bg-blue-100" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
        }`}
      >
        <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
          {initials}
          {user?.avatar_url && <img src={user.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        </span>
        <span className="hidden max-w-[9rem] truncate text-sm font-medium text-slate-800 sm:inline">{user?.name ?? fallbackName}</span>
        <Icon name="chevronDown" size={14} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">{user?.name ?? fallbackName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email ?? "—"}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          {links.map((l) => {
            const current = isCurrent(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={current ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm max-sm:min-h-[44px] ${
                  current ? "bg-blue-100 font-medium text-blue-800" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <NavIcon name={l.icon} size={16} className="shrink-0" /> {l.label}
              </Link>
            );
          })}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => { setOpen(false); setShowConfirm(true); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 max-sm:min-h-[44px]"
          >
            <NavIcon name="logout" size={16} className="shrink-0" /> Log Out
          </button>
        </div>
      )}

      {mounted &&
        createPortal(
          <ConfirmDialog
            open={showConfirm}
            title="Log out?"
            confirmLabel="Log Out"
            onCancel={() => setShowConfirm(false)}
            onConfirm={() => { setShowConfirm(false); onLogout(); }}
          >
            <p>You&apos;ll need to sign in again to access your account.</p>
          </ConfirmDialog>,
          document.body
        )}
    </div>
  );
}
