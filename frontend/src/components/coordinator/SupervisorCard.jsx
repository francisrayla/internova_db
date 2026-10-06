"use client";

import Link from "next/link";
import ActionMenu from "@/components/ui/ActionMenu";
import { Avatar, Pill } from "@/components/ui";
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
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <Avatar name={s.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={s.name}>{s.name}</p>
          <p className="truncate text-xs text-slate-500">
            {s.position || "Supervisor"}
            {showCompany && s.company_name && (
              <>
                {" at "}
                <Link href={`/coordinator/companies/${s.company_id}`} className="font-medium text-blue-600 hover:underline">{s.company_name}</Link>
              </>
            )}
          </p>
        </div>
        <Pill tone={status.tone} size="sm" className="shrink-0">{status.label}</Pill>
        <ActionMenu label={`Actions for ${s.name}`} items={menuItems} />
      </div>

      <p className="mt-1.5 truncate pl-[46px] text-xs text-slate-600" title={s.email ?? ""}>{s.email}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[46px] text-xs">
        {count > 0 ? (
          <Link href={`/coordinator/interns?company=${s.company_id}`} className="font-semibold text-blue-600 hover:underline">
            {count} active intern{count === 1 ? "" : "s"}
          </Link>
        ) : (
          <span className="text-slate-500">No active interns</span>
        )}
        <span className="text-slate-500">{lastActive}</span>
      </div>
      {s.status === "bounced" && (
        <p className="mt-1.5 pl-[46px] text-xs text-red-700">The invitation email did not arrive. Check the address with Change email.</p>
      )}
    </article>
  );
}
