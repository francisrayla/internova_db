"use client";

import { useCurrentUser } from "@/lib/UserContext";
import NotificationHistory from "@/components/NotificationHistory";

export default function Page() {
  const { user } = useCurrentUser();
  if (!user) return null;

  return <NotificationHistory audienceRole="dean" schoolId={user.school_id} userId={user.id} title="Notifications" />;
}
