"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";

function initialsOf(name, fallback) {
  return (name || fallback || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

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
  const rootRef = useRef(null);

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
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-3 hover:bg-slate-100"
      >
        <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-blue-600 text-xs font-semibold text-white">
          {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
        <span className="text-sm font-medium text-slate-800">{user?.name ?? fallbackName}</span>
        <Icon name="chevronDown" size={14} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">{user?.name ?? fallbackName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email ?? "—"}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Icon name={l.icon} size={16} /> {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Icon name="logout" size={16} /> Log Out
          </button>
        </div>
      )}
    </div>
  );
}
