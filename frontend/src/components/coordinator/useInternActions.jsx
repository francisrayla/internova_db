"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import FixEmailModal from "@/components/FixEmailModal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ManageDeploymentModal from "./ManageDeploymentModal";

/**
 * Every per-intern action in one place (Interns page and the company's Interns tab):
 * menuFor(intern) gives the ActionMenu items, `dialogs` must be rendered once by the page.
 * Destructive actions (archive, delete) always go through a ConfirmDialog.
 */
export default function useInternActions({ reload, onNotice, onError }) {
  const [managing, setManaging] = useState(null);
  const [fixing, setFixing] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "archive" | "delete", intern }
  const [confirmError, setConfirmError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function request(path, options, fallback) {
    const res = await apiFetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || fallback);
    return data;
  }

  async function resend(intern) {
    setBusyId(intern.deployment_id);
    try {
      await request(`/api/coordinator/users/${intern.intern_id}/resend-invitation`, { method: "POST" }, "Could not resend the invitation.");
      onNotice(`Invitation sent again to ${intern.intern_email ?? intern.intern_name}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(intern, status) {
    await request(
      `/api/coordinator/interns/${intern.deployment_id}/status`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
      "Could not update status."
    );
  }

  async function restore(intern) {
    setBusyId(intern.deployment_id);
    try {
      await setStatus(intern, "active");
      onNotice(`${intern.intern_name} is active again.`);
      reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function runConfirmed() {
    const { kind, intern } = confirm;
    setBusyId(intern.deployment_id);
    setConfirmError("");
    try {
      if (kind === "archive") {
        await setStatus(intern, "inactive");
        onNotice(`${intern.intern_name} was archived. You can restore them from the Archive page.`);
      } else {
        await request(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" }, "Could not delete intern.");
        onNotice(`${intern.intern_name} was deleted.`);
      }
      setConfirm(null);
      reload();
    } catch (err) {
      setConfirmError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function menuFor(i) {
    const pending = i.display_status === "invitation_pending";
    return [
      { key: "report", label: "View report", icon: "file", href: `/coordinator/interns/${i.deployment_id}/report` },
      { key: "portfolio", label: "View portfolio", icon: "user", href: `/coordinator/interns/${i.deployment_id}/portfolio` },
      i.status === "active" && { key: "manage", label: "Manage deployment", icon: "edit", onSelect: () => setManaging(i) },
      pending && { key: "resend", label: "Resend invitation", icon: "mail", onSelect: () => resend(i) },
      pending && { key: "email", label: "Change email", icon: "edit", onSelect: () => setFixing(i) },
      i.status === "inactive" && { key: "restore", label: "Mark as active", icon: "check", onSelect: () => restore(i) },
      i.status === "active" && { key: "archive", label: "Archive intern", icon: "download", onSelect: () => { setConfirmError(""); setConfirm({ kind: "archive", intern: i }); } },
      { key: "delete", label: "Delete intern", icon: "trash", danger: true, onSelect: () => { setConfirmError(""); setConfirm({ kind: "delete", intern: i }); } },
    ];
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "delete" ? `Delete ${confirm?.intern.intern_name}?` : `Archive ${confirm?.intern.intern_name}?`}
        confirmLabel={confirm?.kind === "delete" ? "Delete intern" : "Archive intern"}
        busy={!!confirm && busyId === confirm.intern.deployment_id}
        error={confirmError}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === "delete" ? (
          <>
            <p>This permanently removes their account and deployment. It can&apos;t be undone.</p>
            <p>Interns who already have attendance, tasks, evaluations or documents can&apos;t be deleted. Archive them instead.</p>
          </>
        ) : (
          <>
            <p>They will move to the Archive page and stop showing in this list. Their hours, tasks and evaluations are kept.</p>
            <p>You can restore them any time.</p>
          </>
        )}
      </ConfirmDialog>
      {managing && (
        <ManageDeploymentModal
          intern={managing}
          currentCompanyId={managing.company_id}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); onNotice("Deployment updated."); reload(); }}
        />
      )}
      {fixing && (
        <FixEmailModal
          userId={fixing.intern_id}
          name={fixing.intern_name}
          currentEmail={fixing.intern_email}
          onClose={() => setFixing(null)}
          onFixed={(email) => { setFixing(null); onNotice(`Invitation sent to ${email}.`); reload(); }}
        />
      )}
    </>
  );

  return { menuFor, dialogs, busyId };
}
