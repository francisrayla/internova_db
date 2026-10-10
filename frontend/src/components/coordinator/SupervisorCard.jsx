"use client";

import Link from "next/link";
import ActionMenu from "@/components/ui/ActionMenu";
import { Avatar, Pill } from "@/components/ui";
import { DataRow } from "@/components/dash/page";
import { timeAgo } from "@/lib/timeAgo";

export const SUPERVISOR_STATUS = {
  active: { label: "Active", tone: "green" },
  pending: { label: "Invitation pending", tone: "amber" },
  bounced: { label: "Email bounced", tone: "red" },
  inactive: { label: "Inactive", tone: "slate" },
};

/** One supervisor: who they are, whether they can sign in, who they supervise and when they last signed in. */
export default function SupervisorCard({ supervisor: s, menuItems, showCompany = true }) {
  const status = SUPERVISOR_STATUS[s.status] ?? SUPERVISOR_STATUS.active;
  const count = s.interns_count ?? 0;
  const lastActive =
    s.status === "pending" || s.status === "bounced"
      ? "Has not signed in yet"
      : s.last_active_at
        ? `Last active ${timeAgo(s.last_active_at)}`
        : "Has not signed in yet";

  return (
    <DataRow
      wrap
      lead={<Avatar name={s.name} size={40} />}
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words" title={s.name}>{s.name}</span>
          <Pill tone={status.tone} size="sm">{status.label}</Pill>
        </span>
      }
      sub={
        <>
          <span className="block break-words">
            {s.position || "Supervisor"}
            {showCompany && s.company_name && (
              <>
                {" at "}
                <Link href={`/coordinator/companies/${s.company_id}`} className="font-medium text-blue-600 hover:underline">{s.company_name}</Link>
              </>
            )}
          </span>
          <span className="block break-all" title={s.email ?? ""}>{s.email}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {count > 0 ? (
              <Link href={`/coordinator/interns?company=${s.company_id}`} className="font-semibold text-blue-600 hover:underline">
                {count} active intern{count === 1 ? "" : "s"}
              </Link>
            ) : (
              <span>No active interns</span>
            )}
            <span>{lastActive}</span>
          </span>
          {s.status === "bounced" && (
            <span className="mt-1 block text-red-700">The invitation email did not arrive. Check the address with Change email.</span>
          )}
        </>
      }
      side={<ActionMenu label={`Actions for ${s.name}`} items={menuItems} />}
    />
  );
}
