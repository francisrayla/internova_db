"use client";

import { useEffect, useState } from "react";

export default function SubscriptionNotice() {
  const [inactive, setInactive] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("internova_user");
      if (!raw) return;
      const user = JSON.parse(raw);
      if (user.school_id && user.school_status && user.school_status !== "active") {
        setInactive(true);
      }
    } catch {
      // ignore malformed/missing session — just skip the notice
    }
  }, []);

  if (!inactive) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Your school subscription is inactive. Please contact your school's Coordinator or the Super Admin.
    </div>
  );
}
