"use client";

import { useCurrentUser } from "@/lib/UserContext";
import NavIcon from "@/components/NavIcon";
import { KeyValueList, Page, Pill } from "@/components/dash/page";

/** Shown to a Dean whose school registration is still being reviewed (same wording as before, kit look). */
export default function PendingApproval() {
  const { user } = useCurrentUser();

  if (!user) return null;

  return (
    <Page size="narrow">
      <section className="dash-card space-y-5 text-center max-sm:py-6">
        <div>
          <NavIcon name="attendance" size={30} className="mx-auto text-slate-500" />
          <p className="mt-3"><Pill tone="amber">Account Status: Pending Approval</Pill></p>
          <h1 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">Your school registration is under review</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Thanks for registering, <strong>{user.name}</strong>! Our team is reviewing your school&apos;s registration.
            You&apos;ll get access to your dashboard as soon as it&apos;s approved and your payment is confirmed.
          </p>
        </div>
        <div className="text-left">
          <KeyValueList
            className="max-[519px]:[&>div]:grid-cols-[minmax(0,1fr)_auto] max-[519px]:[&>div]:gap-x-4 max-[519px]:[&_dd]:text-right"
            items={[
              { label: "Email", value: user.email },
              { label: "Status", value: <span className="text-amber-700">Pending Approval</span> },
            ]}
          />
        </div>
        <p className="text-xs text-slate-600">Try logging out and back in after a day or two to check for an update.</p>
      </section>
    </Page>
  );
}
