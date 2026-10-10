"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import FileLink from "@/components/FileViewer";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { apiFetch } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { LoadMore } from "@/components/Pagination";
import { Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, Page, PageHeader, Section, Select } from "@/components/dash/page";

const STATUS_TONES = {
  approved: "green",
  pending: "amber",
  rejected: "red",
  recorded: "slate",
};

export default function InternActivities() {
  const [activities, setActivities] = useState([]);
  // The dashboard links here with ?status=pending.
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(() => (Object.keys(STATUS_TONES).includes(params.get("status")) ? params.get("status") : ""));
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  // Pending entries in the whole list (every page), not only the ones loaded so far.
  const [pendingTotal, setPendingTotal] = useState(0);
  const requestRef = useRef(0);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState(null); // entry waiting for "yes, reject it"

  // Page 1 replaces the list (filter changed or an entry was reviewed); a later page is appended.
  function load(nextPage = 1, keepError = false) {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (statusFilter) query.set("status", statusFilter);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchSupervisorData(`activities?${query}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        const rows = r.activities ?? [];
        setActivities((prev) => {
          if (nextPage === 1) return rows;
          const have = new Set(prev.map((a) => a.id));
          return [...prev, ...rows.filter((a) => !have.has(a.id))];
        });
        setPage(nextPage);
        setHasMore(Boolean(r.has_more));
        setTotal(r.total ?? rows.length);
        setPendingTotal(r.pending_total ?? 0);
        if (!keepError) setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }

  useEffect(() => {
    load(1);
  }, [statusFilter]);

  function changeStatus(value) {
    setLoading(true);
    setStatusFilter(value);
  }

  function loadMore() {
    setLoadingMore(true);
    load(page + 1);
  }

  // Only meaningful when pending entries can be in the list.
  const canApproveAll = (statusFilter === "" || statusFilter === "pending") && pendingTotal > 0;

  async function approveAll() {
    setConfirmApprove(false);
    setApprovingAll(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/supervisor/activities/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all_pending: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Couldn't approve these entries.");
      setNotice(data.message);
      load();
    } catch (err) {
      setError(err.message);
      load(1, true); // the list may be out of date (someone else already decided these entries)
    } finally {
      setApprovingAll(false);
    }
  }

  async function review(id, status) {
    setNotice("");
    setError("");
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/supervisor/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      load();
    } catch (err) {
      setError(err.message || "Couldn't save that decision.");
      load(1, true); // show the entry as it is now, not as it was when the page loaded
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Daily Activities"
        sentence="Review the narrative entries your interns write. Only approved entries go into their narrative report. Daily summaries the system records from attendance don't need your approval."
      />

      <FilterBar>
        <Select value={statusFilter} onChange={(e) => changeStatus(e.target.value)} aria-label="Filter by status" className="sm:max-w-[220px]">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="recorded">Recorded (auto)</option>
        </Select>
        {!loading && canApproveAll && (
          <Btn
            variant="primary"
            onClick={() => setConfirmApprove(true)}
            disabled={approvingAll || busyId !== null}
            className="max-sm:w-full sm:ml-auto"
          >
            {approvingAll ? "Approving…" : `Approve all pending (${pendingTotal})`}
          </Btn>
        )}
      </FilterBar>

      {notice && <Banner tone="green">{notice}</Banner>}
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-20" /></div>
        ) : activities.length === 0 && error ? null : activities.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="activities" title="No activity entries yet" text="Narrative entries your interns write will show up here for review." />
          </div>
        ) : (
          <ul className="k-list">
            {activities.map((a) => (
              <li key={a.id} className="k-item">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                  <div className="flex min-w-0 flex-1 gap-3">
                    {a.photo_url && (
                      <FileLink url={a.photo_url} name={a.title} type="image/jpeg" subtitle={`${a.intern_name} · ${a.activity_date}`} className="shrink-0 cursor-zoom-in">
                        <img src={a.photo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                      </FileLink>
                    )}
                    <div className="min-w-0">
                      <p className="break-words font-medium text-slate-900">{a.title}</p>
                      <p className="text-xs text-slate-500">
                        {a.intern_name} · {a.activity_date}
                      </p>
                      {a.description && <p className="mt-1.5 whitespace-pre-line break-words text-sm text-slate-600">{a.description}</p>}
                      {a.status === "recorded" && (
                        <p className="mt-1.5 text-xs text-slate-500">Recorded automatically from attendance — no approval needed.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:mt-1">
                    <Pill tone={STATUS_TONES[a.status] ?? "slate"} className="capitalize">{a.status}</Pill>
                    {a.status === "pending" && (
                      <>
                        <Btn sm className="text-emerald-700 max-sm:flex-1" onClick={() => review(a.id, "approved")} disabled={busyId === a.id || approvingAll}>Approve</Btn>
                        <Btn sm variant="danger-quiet" className="max-sm:flex-1" onClick={() => setRejecting(a)} disabled={busyId === a.id || approvingAll}>Reject</Btn>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && <LoadMore shown={activities.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />}
      </Section>
      <ConfirmDialog open={confirmApprove} title={`Approve all ${pendingTotal} pending ${pendingTotal === 1 ? "entry" : "entries"}?`} tone="primary" confirmLabel="Approve all" onConfirm={approveAll} onCancel={() => setConfirmApprove(false)}>
        <p>Approved entries go into the interns&apos; narrative reports.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!rejecting}
        title="Reject this entry?"
        confirmLabel="Reject entry"
        onConfirm={() => { const entry = rejecting; setRejecting(null); review(entry.id, "rejected"); }}
        onCancel={() => setRejecting(null)}
      >
        <p>&ldquo;{rejecting?.title}&rdquo; by {rejecting?.intern_name} will not go into their narrative report. The intern will see it as rejected.</p>
      </ConfirmDialog>
    </Page>
  );
}
