"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SubscriptionStatus() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("internova_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore malformed/missing session
    }
  }, []);

  function handleLogout() {
    localStorage.removeItem("internova_user");
    router.push("/login");
  }

  if (!user) return null;

  const isSuspended = user.school_suspended;

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl bg-white p-10 shadow-xl text-center">
        <div className="text-5xl">{isSuspended ? "⛔" : "⏳"}</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {isSuspended ? "Account Suspended" : "Subscription Expired"}
        </h1>
        <p className="mt-3 text-slate-600">
          {isSuspended
            ? `${user.school_name}'s access has been suspended by the Super Admin. Operational features are locked until access is restored.`
            : `${user.school_name}'s subscription period has ended. Renew to restore full access to your workspace.`}
        </p>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-left text-sm space-y-2">
          <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-900">{user.subscription_plan ?? "—"}</span></div>
          {user.subscription_end_date && (
            <div className="flex justify-between"><span className="text-slate-500">{isSuspended ? "Valid Until" : "Expired On"}</span><span className="font-semibold text-slate-900">{user.subscription_end_date}</span></div>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-400">
          This is a read-only status screen — no data can be created or edited while your account is in this state.
        </p>

        <a
          href="mailto:hello@internova.ai"
          className="mt-6 block w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Contact Super Admin
        </a>
        <button onClick={handleLogout} className="mt-3 w-full rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Log Out
        </button>
      </div>
    </div>
  );
}
