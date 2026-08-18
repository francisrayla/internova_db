"use client";

import { useEffect, useState } from "react";

export default function SchoolSettingsPage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("internova_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore malformed/missing session
    }
  }, []);

  if (!user) return null;

  if (!user.is_primary_coordinator) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">School Settings</h1>
        <p className="mt-2 text-slate-600">Only the school's primary coordinator can view or edit school settings.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">School Settings</h1>
      <p className="mt-2 text-slate-600">Basic information for your school account.</p>

      <div className="mt-6 max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-sm">
        <div className="flex justify-between border-b border-slate-100 py-2.5">
          <span className="text-slate-500">School Name</span>
          <span className="font-semibold text-slate-900">{user.school_name}</span>
        </div>
        <div className="flex justify-between border-b border-slate-100 py-2.5">
          <span className="text-slate-500">Primary Coordinator</span>
          <span className="font-semibold text-slate-900">{user.name}</span>
        </div>
        <div className="flex justify-between border-b border-slate-100 py-2.5">
          <span className="text-slate-500">Contact Email</span>
          <span className="font-semibold text-slate-900">{user.email}</span>
        </div>
        <div className="flex justify-between py-2.5">
          <span className="text-slate-500">School Status</span>
          <span className="font-semibold capitalize text-slate-900">{user.school_status}</span>
        </div>
      </div>
    </div>
  );
}
