"use client";

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { KeyValueList, Page, Pill, Section } from "@/components/dash/page";

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
    <Page size="narrow" className="py-4 sm:py-10">
      <Section>
        <div className="mx-auto max-w-lg text-center">
          <span className="inline-flex text-slate-500"><Hourglass aria-hidden="true" size={36} strokeWidth={1.6} /></span>
          <p className="mt-3"><Pill tone="amber">Account Status: Pending Approval</Pill></p>
          <h1 className="mt-4 text-xl font-semibold text-slate-900 sm:text-2xl">Your school registration is under review</h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            Thanks for registering, <strong className="text-slate-900">{user.name}</strong>! Our team is reviewing your school&apos;s registration.
            You&apos;ll get access to your dashboard as soon as it&apos;s approved and your payment is confirmed.
          </p>
          <div className="mt-6 text-left">
            <KeyValueList
              items={[
                { label: "Email", value: user.email },
                { label: "Status", value: "Pending Approval" },
              ]}
            />
          </div>
          <p className="k-hint mt-4">
            Try logging out and back in after a day or two to check for an update.
          </p>
        </div>
      </Section>
    </Page>
  );
}
