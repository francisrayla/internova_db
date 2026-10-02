"use client";

import StaffProfile from "@/components/StaffProfile";
import { useCurrentUser } from "@/lib/UserContext";

export default function MyProfile() {
  const { user } = useCurrentUser();
  return <StaffProfile fallbackName="Coordinator" roleLabel={user?.is_primary_coordinator ? "Primary Coordinator" : "Coordinator"} />;
}
