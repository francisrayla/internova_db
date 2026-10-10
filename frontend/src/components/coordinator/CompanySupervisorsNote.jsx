"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

/**
 * Interns are no longer assigned to a supervisor one by one: every supervisor
 * of the company handles every intern there. This replaces the old Supervisor
 * picker with a short note naming who that is.
 */
export default function CompanySupervisorsNote({ companyId, companyName, className = "" }) {
  const [names, setNames] = useState(null);

  useEffect(() => {
    if (!companyId) return undefined;
    let alive = true;
    fetchCoordinatorData(`supervisors?company_id=${companyId}`)
      .then((r) => alive && setNames((r.supervisors ?? []).filter((s) => s.status === "active").map((s) => s.name)))
      .catch(() => alive && setNames([]));
    return () => {
      alive = false;
    };
  }, [companyId]);

  if (!companyId) return null;
  const company = companyName || "this company";
  let text;
  if (names === null) text = "";
  else if (names.length === 0) text = `${company} has no active supervisor yet. Add one on the Supervisors page so this intern has someone to log and review their work.`;
  else if (names.length === 1) text = `The supervisor at ${company} (${names[0]}) will handle this intern.`;
  else text = `Both supervisors at ${company} will handle this intern (${names.join(", ")}).`;
  if (!text) return null;

  return (
    <p className={`k-note ${names.length === 0 ? "is-warn" : ""} ${className}`}>
      {text}
    </p>
  );
}
