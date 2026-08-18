"use client";

import { useEffect, useState } from "react";
import NotificationHistory from "@/components/NotificationHistory";

export default function InternNotifications() {
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
    <NotificationHistory
      audienceRole="intern"
      schoolId={user.school_id}
      userId={user.id}
      title="Notifications"
    />
  );
}
