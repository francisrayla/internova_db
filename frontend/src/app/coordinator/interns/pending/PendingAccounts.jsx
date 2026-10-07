"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import FixEmailModal from "@/components/FixEmailModal";
import Icon from "@/components/Icon";
import { Avatar, Banner, BackLink, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";

function statusOf(i) {
  if (i.email_bounced) return { label: "Email bounced", tone: "red", help: "The invitation could not be delivered. The email is probably misspelled." };
  if (i.invitation_expired) return { label: "Link expired", tone: "red", help: "The invitation link is older than 7 days. Send a new one." };
  return { label: "Waiting for the intern", tone: "amber", help: "They have not opened the invitation link yet." };
}

/**
 * Interns invited by email who have not set up their account yet. They stay off the main roster
 * and cannot be given tasks until they do. A wrong email is fixed here, which sends a fresh link
 * to the corrected address (the old link stops working).
 */
export default function PendingAccounts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fixing, setFixing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    fetchCoordinatorData("interns")
      .then((r) => {
        setRows((r.interns ?? []).filter((i) => i.display_status === "invitation_pending"));
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function resend(i) {
    setBusyId(i.deployment_id);
    setNotice("");
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/users/${i.intern_id}/resend-invitation`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not resend the invitation.");
      setNotice(`A new invitation link was sent to ${i.intern_email}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <BackLink href="/coordinator/interns">← Back to Interns</BackLink>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">Pending accounts</h2>
        <p className="mt-1 text-sm text-slate-600">
          Interns who have not set up their account yet. They are not on the Interns list and cannot be given tasks until they open the
          invitation link. If the email is wrong, fix it here and a new link goes to the corrected address.
        </p>
      </div>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title="Everyone has set up their account" text="Newly invited interns will show up here until they open their invitation link." />
      ) : (
        <ul className="space-y-3">
          {rows.map((i) => {
            const s = statusOf(i);
            return (
              <li key={i.deployment_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <Avatar name={i.intern_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-slate-900">{i.intern_name}</p>
                      <Pill tone={s.tone} size="sm">{s.label}</Pill>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 break-all text-sm text-slate-700">
                      <Icon name="mail" size={14} className="shrink-0 text-slate-400" /> {i.intern_email}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{[i.company_name, i.course].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1.5 text-xs text-slate-500">{s.help}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFixing(i)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Icon name="edit" size={14} /> Edit email
                  </button>
                  <button
                    type="button"
                    onClick={() => resend(i)}
                    disabled={busyId === i.deployment_id}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <Icon name="mail" size={14} /> {busyId === i.deployment_id ? "Sending…" : "Resend invitation"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {fixing && (
        <FixEmailModal
          userId={fixing.intern_id}
          name={fixing.intern_name}
          currentEmail={fixing.intern_email}
          onClose={() => setFixing(null)}
          onFixed={(email) => { setFixing(null); setNotice(`The email was corrected and a new invitation link was sent to ${email}.`); load(); }}
        />
      )}
    </div>
  );
}
