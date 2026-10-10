"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import FixEmailModal from "@/components/FixEmailModal";
import Pagination from "@/components/Pagination";
import Icon from "@/components/Icon";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, DataList, DataRow, Page, PageHeader, Section } from "@/components/dash/page";

const PER_PAGE = 15;

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
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [paging, setPaging] = useState(false);
  const requestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fixing, setFixing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // After a whole class is imported there can be hundreds waiting, so the server returns one page at a time.
  function load() {
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`interns?page=${page}&per_page=${PER_PAGE}&scope=roster&filter=invitation_pending`)
      .then((r) => {
        if (request !== requestRef.current) return;
        // Fixing the last row of the last page leaves that page empty: go back one.
        if (page > 1 && (r.interns ?? []).length === 0 && (r.last_page ?? 1) < page) {
          setPage(r.last_page ?? 1);
          return;
        }
        setRows(r.interns ?? []);
        setMeta({ total: r.total ?? 0, last_page: r.last_page ?? 1 });
        setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setPaging(false);
      });
  }

  useEffect(load, [page]);

  function goToPage(next) {
    setPaging(true);
    setPage(next);
  }

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
    <Page>
      <PageHeader
        back={{ href: "/coordinator/interns", label: "Back to Interns" }}
        title="Pending accounts"
        sentence="Interns who have not set up their account yet. They are not on the Interns list and cannot be given tasks until they open the invitation link. If the email is wrong, fix it here and a new link goes to the corrected address."
      />

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} /></div>
        ) : rows.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="check" title="Everyone has set up their account" text="Newly invited interns will show up here until they open their invitation link." />
          </div>
        ) : (
          <DataList>
            {rows.map((i) => {
              const s = statusOf(i);
              return (
                <DataRow
                  key={i.deployment_id}
                  wrap
                  lead={<Avatar name={i.intern_name} />}
                  title={<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-words">{i.intern_name}</span><Pill tone={s.tone} size="sm">{s.label}</Pill></span>}
                  sub={
                    <>
                      <span className="flex items-center gap-1.5 break-all"><Icon name="mail" size={14} className="shrink-0" /> {i.intern_email}</span>
                      <span className="block">{[i.company_name, i.course].filter(Boolean).join(" · ")}</span>
                      <span className="mt-0.5 block">{s.help}</span>
                    </>
                  }
                  actions={
                    <>
                      <Btn onClick={() => setFixing(i)}>
                        <Icon name="edit" size={14} /> Edit email
                      </Btn>
                      <Btn variant="primary" onClick={() => resend(i)} disabled={busyId === i.deployment_id}>
                        <Icon name="mail" size={14} /> {busyId === i.deployment_id ? "Sending…" : "Resend invitation"}
                      </Btn>
                    </>
                  }
                />
              );
            })}
          </DataList>
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={paging} onPageChange={goToPage} />
      </Section>

      {fixing && (
        <FixEmailModal
          userId={fixing.intern_id}
          name={fixing.intern_name}
          currentEmail={fixing.intern_email}
          onClose={() => setFixing(null)}
          onFixed={(email) => { setFixing(null); setNotice(`The email was corrected and a new invitation link was sent to ${email}.`); load(); }}
        />
      )}
    </Page>
  );
}
