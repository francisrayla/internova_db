"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Hourglass } from "lucide-react";
import { Btn, KeyValueList, Page, Section } from "@/components/dash/page";

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
  // Neither suspended nor lapsed: the school's subscription isn't active yet, and only the Dean can pay for it.
  const isWaiting = !isSuspended && user.subscription_status !== "expired";

  const StatusIcon = isSuspended ? Ban : Hourglass;
  const rows = [{ label: "Plan", value: user.subscription_plan ?? "—" }];
  if (user.subscription_end_date) rows.push({ label: isSuspended ? "Valid Until" : "Expired On", value: user.subscription_end_date });

  return (
    <Page size="narrow" className="py-4 sm:py-10">
      <Section>
        <div className="mx-auto max-w-lg text-center">
          <span className="inline-flex text-slate-500"><StatusIcon aria-hidden="true" size={36} strokeWidth={1.6} /></span>
          <h1 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
            {isSuspended ? "Account Suspended" : isWaiting ? "Waiting for your Dean" : "Subscription Expired"}
          </h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            {isSuspended
              ? `${user.school_name}'s access has been suspended by the Super Admin. Operational features are locked until access is restored.`
              : isWaiting
                ? `Waiting for your Dean to activate the subscription. Your workspace opens as soon as ${user.school_name}'s Dean accepts the plan and pays.`
                : `${user.school_name}'s subscription period has ended. Ask your Dean to renew it to restore full access to your workspace.`}
          </p>

          <div className="mt-6 text-left">
            <KeyValueList items={rows} />
          </div>

          <p className="k-hint mt-4">
            This is a read-only status screen — no data can be created or edited while your account is in this state.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Btn variant="primary" block href="mailto:hello@internova.ai">Contact Super Admin</Btn>
            <Btn block onClick={handleLogout}>Log Out</Btn>
          </div>
        </div>
      </Section>
    </Page>
  );
}
