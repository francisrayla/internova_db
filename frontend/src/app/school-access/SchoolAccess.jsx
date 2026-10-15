"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Hourglass, Lock } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";
import { Btn } from "@/components/dash/page";
import { apiFetch } from "@/lib/apiFetch";
import { clearOfflineCaches } from "@/lib/offlineCache";
import { readStoredUser, resolveDashboardPath } from "@/lib/roleDashboard";
import { headTitle } from "@/lib/headTitle";

// Where apiFetch sends interns, supervisors and a suspended Dean when the API answers 403 with
// school_suspended / subscription_expired / subscription_unpaid (EnsureSchoolAccess). The session is
// kept: this page re-reads the account, and as soon as the school is open again it goes back to the
// dashboard. Coordinators use /coordinator/subscription-status and a Dean with a billing problem
// goes to /dean/billing, so this page is for the rest.
const COPY = {
  suspended: {
    icon: Ban,
    tone: "red",
    title: "Your school's access is paused",
    text: () => "The Super Admin has suspended this school's access for now. Nothing is lost. Your work stays saved and opens again once access is restored.",
  },
  expired: {
    icon: Lock,
    tone: "amber",
    title: "Your school's subscription has ended",
    text: (head) => `The subscription period ended. The school's ${head} can renew it in Billing, and your workspace opens again right after.`,
  },
  unpaid: {
    icon: Hourglass,
    tone: "amber",
    title: "Waiting for the school's subscription",
    text: (head) => `The school's subscription is not active yet. Your workspace opens as soon as the ${head} accepts the plan and pays.`,
  },
};

export default function SchoolAccess() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [reason, setReason] = useState(() => {
    if (typeof window === "undefined") return "suspended";
    const fromUrl = new URLSearchParams(window.location.search).get("reason");
    return COPY[fromUrl] ? fromUrl : "suspended";
  });
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");

  async function recheck(stored) {
    setChecking(true);
    setNote("");
    try {
      const res = await apiFetch(`/api/auth/session/${stored.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setNote("We couldn't check right now. Please try again in a moment.");
        return;
      }
      localStorage.setItem("internova_user", JSON.stringify(data.user));
      setUser(data.user);
      if (data.user.school_suspended) setReason("suspended");
      else if (data.user.subscription_status === "expired" || data.user.subscription_status === "offer_expired") setReason("expired");
      else if (data.user.subscription_status !== "active") setReason("unpaid");
      else {
        router.replace(resolveDashboardPath(data.user) ?? "/");
        return;
      }
      setNote("Still closed. We'll let you in as soon as it opens.");
    } catch {
      setNote("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const stored = readStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    // Show the cached account at once, then re-read it from the server (the cached copy may be stale).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(stored);
    recheck(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("internova_user");
    localStorage.removeItem("internova_token");
    clearOfflineCaches();
    router.push("/login");
  }

  if (!user) return null;

  const copy = COPY[reason] || COPY.suspended;
  const name = user.school_name ? ` (${user.school_name})` : "";

  return (
    <StatusScreen icon={copy.icon} tone={copy.tone} eyebrow="School access" title={copy.title} text={copy.text(headTitle(user))} detail={note || `Signed in as ${user.email}${name}`}>
      <Btn variant="primary" block onClick={() => recheck(user)} disabled={checking}>{checking ? "Checking…" : "Check again"}</Btn>
      {user.role === "dean" ? <Btn block href="/dean/billing">Open billing</Btn> : null}
      <Btn block onClick={logout}>Log out</Btn>
    </StatusScreen>
  );
}
