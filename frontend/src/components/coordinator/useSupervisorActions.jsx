"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import FixEmailModal from "@/components/FixEmailModal";
import { EditSupervisorModal } from "./SupervisorModals";

/**
 * Per-supervisor actions shared by the Supervisors page and the company's Supervisors tab.
 * menuFor(supervisor, { showOpenCompany }) gives the ActionMenu items; render `dialogs` once.
 */
export default function useSupervisorActions({ reload, onNotice, onError }) {
  const [editing, setEditing] = useState(null);
  const [fixing, setFixing] = useState(null);

  async function resend(s) {
    try {
      const res = await apiFetch(`/api/coordinator/users/${s.user_id}/resend-invitation`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not resend the invitation.");
      onNotice(`Invitation sent again to ${s.email}.`);
    } catch (err) {
      onError(err.message);
    }
  }

  function menuFor(s, { showOpenCompany = false } = {}) {
    const pending = s.status === "pending" || s.status === "bounced";
    return [
      { key: "edit", label: "Edit supervisor", icon: "edit", onSelect: () => setEditing(s) },
      pending && { key: "resend", label: "Resend invitation", icon: "mail", onSelect: () => resend(s) },
      pending && { key: "email", label: "Change email", icon: "edit", onSelect: () => setFixing(s) },
      showOpenCompany && { key: "company", label: "Open company", icon: "building", href: `/coordinator/companies/${s.company_id}` },
    ];
  }

  const dialogs = (
    <>
      {editing && (
        <EditSupervisorModal
          supervisor={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onNotice("Changes saved."); reload(); }}
        />
      )}
      {fixing && (
        <FixEmailModal
          userId={fixing.user_id}
          name={fixing.name}
          currentEmail={fixing.email}
          onClose={() => setFixing(null)}
          onFixed={(email) => { setFixing(null); onNotice(`Invitation sent to ${email}.`); reload(); }}
        />
      )}
    </>
  );

  return { menuFor, dialogs };
}
