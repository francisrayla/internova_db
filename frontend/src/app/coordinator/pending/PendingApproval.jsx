"use client";

import { useEffect, useState } from "react";

export default function PendingApprovalPage() {
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

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-3xl bg-white p-10 shadow-xl text-center">
        <div className="text-6xl">⏳</div>
        <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-700">
          Account Status: Pending Approval
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Your school registration is under review</h1>
        <p className="mt-3 text-slate-600">
          Thanks for registering, <strong>{user.name}</strong>! Our team is reviewing your school's registration.
          You'll get access to your dashboard as soon as it's approved and your payment is confirmed.
        </p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-left text-sm text-slate-600">
          <div className="flex justify-between py-1"><span className="text-slate-500">Email</span><span className="font-medium text-slate-900">{user.email}</span></div>
          <div className="flex justify-between py-1"><span className="text-slate-500">Status</span><span className="font-medium text-amber-700">Pending Approval</span></div>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Try logging out and back in after a day or two to check for an update.
        </p>
      </div>
    </div>
  );
}
