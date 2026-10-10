"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ExternalLink, MapPin } from "lucide-react";
import { inputProps } from "@/lib/inputRules";
import RedFlagBadge from "@/components/RedFlagBadge";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { manilaToday } from "@/lib/dueDateUrgency";
import { apiFetch } from "@/lib/apiFetch";
import OfflineEntryBadge from "@/components/OfflineEntryBadge";
import LocationFlags from "@/components/LocationFlags";
import AttendanceSelfies from "@/components/AttendanceSelfies";
import ActionMenu from "@/components/ui/ActionMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { LoadMore } from "@/components/Pagination";
import NavIcon from "@/components/NavIcon";
import { Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, FilterBar, FormField, Input, Page, PageHeader, SearchField, Section, Select, SheetFrame } from "@/components/dash/page";

const STATUS_TONES = {
  approved: "green",
  pending: "amber",
  rejected: "red",
};

function mapsLink(loc) {
  return loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
}

function TimeField({ label, value, onChange }) {
  return (
    <FormField label={label}>
      <Input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

/** "Correct attendance": the supervisor sets the real times of any record (one half of the day for a split day). */
function EditTimesModal({ record, onClose, onSaved }) {
  const [form, setForm] = useState({ clock_in: record.clock_in_value ?? "", clock_out: record.clock_out_value ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const part = record.session_label ? ` (${record.session_label.toLowerCase()})` : "";
  const open = record.is_open;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.clock_in || (!open && !form.clock_out)) {
      setError(open ? "Enter the time in." : "Enter both the time in and the time out.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/supervisor/attendance/${record.id}/times`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clock_in: form.clock_in, clock_out: form.clock_out || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the times.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      title="Correct attendance"
      description={`${record.intern_name} on ${record.attendance_date}${part}: ${record.clock_in ?? "—"} to ${record.clock_out ?? "not timed out yet"}${record.hours != null ? ` (${record.hours}h)` : ""}.`}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Set the times they really worked, in Philippine time. The hours are recomputed, cannot go above {record.max_hours} hours, cannot be in the future and cannot overlap another entry of the same day. {open ? "Leave the time out empty to keep the shift open." : ""}
        </p>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <TimeField label="Time in" value={form.clock_in} onChange={(v) => setForm((f) => ({ ...f, clock_in: v }))} />
          <TimeField label="Time out" value={form.clock_out} onChange={(v) => setForm((f) => ({ ...f, clock_out: v }))} />
        </div>
        {error && <Banner tone="red">{error}</Banner>}
      </div>
    </SheetFrame>
  );
}

function LogAttendanceModal({ interns, mode, onClose, onSaved }) {
  const split = mode === "split";
  const [form, setForm] = useState({ deployment_id: interns[0]?.deployment_id ?? "", attendance_date: "", clock_in: "", clock_out: "", pm_in: "", pm_out: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deployment_id || !form.attendance_date) {
      setError("Select an intern and a date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/supervisor/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, pm_in: split ? form.pm_in : "", pm_out: split ? form.pm_out : "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not log attendance.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      title="Log attendance"
      description="Logged by you counts as verified — no separate approval needed."
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Log attendance"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Intern">
          <Select value={form.deployment_id} onChange={(e) => setForm((f) => ({ ...f, deployment_id: e.target.value }))}>
            {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.starts_on ? `${i.name} (starts ${i.starts_on_label})` : i.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Date">
          <Input type="date" value={form.attendance_date} min={interns.find((i) => String(i.deployment_id) === String(form.deployment_id))?.starts_on ?? undefined} max={manilaToday()} onChange={(e) => setForm((f) => ({ ...f, attendance_date: e.target.value }))} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <TimeField label={split ? "Morning time in" : "Clock in"} value={form.clock_in} onChange={(v) => setForm((f) => ({ ...f, clock_in: v }))} />
          <TimeField label={split ? "Morning time out" : "Clock out"} value={form.clock_out} onChange={(v) => setForm((f) => ({ ...f, clock_out: v }))} />
          {split && <TimeField label="Afternoon time in" value={form.pm_in} onChange={(v) => setForm((f) => ({ ...f, pm_in: v }))} />}
          {split && <TimeField label="Afternoon time out" value={form.pm_out} onChange={(v) => setForm((f) => ({ ...f, pm_out: v }))} />}
        </div>
        {error && <Banner tone="red">{error}</Banner>}
      </div>
    </SheetFrame>
  );
}

const FLAG_FILTERS = ["red", "unchecked"];

export default function InternAttendance() {
  const urlParams = useSearchParams();
  const [records, setRecords] = useState([]);
  const [interns, setInterns] = useState([]);
  const [mode, setMode] = useState("single");
  const [statusFilter, setStatusFilter] = useState("");
  // The notification about an odd-hours clock-in links here with ?flag=unchecked.
  const [flagFilter, setFlagFilter] = useState(() => (FLAG_FILTERS.includes(urlParams.get("flag")) ? urlParams.get("flag") : ""));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [rejecting, setRejecting] = useState(null); // record waiting for "yes, reject it"
  const [checking, setChecking] = useState(null); // red-flag record waiting for "yes, mark as checked"
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reloads the list from page 1 (filters changed or something was updated), or appends the next page.
  function load(nextPage = 1) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (statusFilter) params.set("status", statusFilter);
    if (flagFilter) params.set("flag", flagFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchSupervisorData(`attendance?${params}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        setRecords((prev) => (nextPage > 1 ? [...prev, ...(r.records ?? [])] : r.records ?? []));
        setHasMore(Boolean(r.has_more));
        setTotal(r.total ?? 0);
        setPage(nextPage);
        setInterns(r.interns ?? []);
        setMode(r.attendance_mode ?? "single");
        setError("");
      })
      .catch((e) => request === requestRef.current && setError(e.message))
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }

  useEffect(load, [statusFilter, flagFilter, debouncedSearch]);

  function loadMore() {
    setLoadingMore(true);
    load(page + 1);
  }

  async function checkFlag(id) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/supervisor/attendance/${id}/red-flag`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not mark this as checked.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function askDelete(record) {
    setDeleting(record);
    setDeleteReason("");
    setDeleteError("");
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`/api/supervisor/attendance/${deleting.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete this attendance.");
      setDeleting(null);
      load();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function review(id, status) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/supervisor/attendance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const filtering = Boolean(search || statusFilter || flagFilter);

  return (
    <Page>
      <PageHeader title="Attendance" sentence="Log and verify attendance for the interns at your company.">
        <Btn variant="primary" onClick={() => setShowModal(true)} disabled={interns.length === 0}>
          Log attendance
        </Btn>
      </PageHeader>

      <div className="k-note">
        <span className="min-w-0">
          Your company records attendance as{" "}
          <strong className="font-semibold">{mode === "split" ? "morning and afternoon (4 entries a day)" : "one time in and one time out"}</strong>.
        </span>
        <Link href="/supervisor/settings/attendance" className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2 max-sm:min-h-[44px]">
          Change attendance format
          <NavIcon name="arrow" size={14} />
        </Link>
      </div>

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search intern name…"
          aria-label="Search intern name"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} aria-label="Filter by red flag">
          <option value="">All records</option>
          <option value="red">Red flags only</option>
          <option value="unchecked">Unchecked red flags</option>
        </Select>
        {filtering && (
          <Btn variant="ghost" sm onClick={() => { setSearch(""); setStatusFilter(""); setFlagFilter(""); }}>
            Clear filters
          </Btn>
        )}
      </FilterBar>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={4} height="h-16" /></div>
        ) : records.length === 0 && error ? null : records.length === 0 ? (
          <div className="k-pad">
            <EmptyState
              icon="attendance"
              title={filtering ? "No matches" : "No attendance yet"}
              text={filtering ? "No attendance records match these filters." : "No attendance records yet."}
            />
          </div>
        ) : (
          <ul className="k-list">
            {records.map((r) => (
              <li
                key={r.id}
                className={`border-l-4 ${r.red_flag ? (r.red_flag_checked ? "border-l-red-300" : "border-l-red-600 bg-red-50/40") : "border-l-transparent"}`}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
                    <AttendanceSelfies record={r} name={r.intern_name} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
                        <span className="min-w-0 break-words">{r.intern_name}</span>
                        {r.session_label && <Pill tone="blue" size="sm">{r.session_label}</Pill>}
                      </p>
                      <RedFlagBadge record={r} className="mt-1" />
                      <p className="mt-0.5 text-xs text-slate-500">
                        {r.attendance_date} · {r.clock_in ?? "—"} to {r.clock_out ?? "—"} {r.hours != null && `(${r.hours}h)`}
                      </p>
                      {(r.auto_clocked_out || r.edited || r.clock_in_is_offline || r.clock_out_is_offline || r.location_flags?.length > 0 || r.clock_in_distance_m != null || r.clock_out_distance_m != null) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {r.auto_clocked_out && <Pill tone="amber" size="sm"><span title="Forgot to time out — closed automatically after 8 hours, no photo or location">Auto time-out</span></Pill>}
                          {r.edited && <Pill tone="blue" size="sm"><span title="A supervisor corrected the times of this record">Time corrected</span></Pill>}
                          <OfflineEntryBadge record={r} />
                          <LocationFlags record={r} />
                        </div>
                      )}
                      {(r.clock_in_location || r.clock_out_location) && (
                        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                          {r.clock_in_location && (
                            <a href={mapsLink(r.clock_in_location)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600 hover:underline max-sm:min-h-[44px]">
                              <MapPin size={13} aria-hidden="true" /> In location <ExternalLink size={11} aria-hidden="true" />
                            </a>
                          )}
                          {r.clock_out_location && (
                            <a href={mapsLink(r.clock_out_location)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600 hover:underline max-sm:min-h-[44px]">
                              <MapPin size={13} aria-hidden="true" /> Out location <ExternalLink size={11} aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                    <Pill tone={STATUS_TONES[r.status] ?? "slate"} className="capitalize">{r.status}</Pill>
                    {r.red_flag && !r.red_flag_checked && (
                      <Btn sm variant="danger-quiet" onClick={() => setChecking(r)} disabled={busyId === r.id}>
                        {busyId === r.id ? "Saving…" : "Mark as checked"}
                      </Btn>
                    )}
                    {r.status === "pending" && (
                      <>
                        <Btn sm className="text-emerald-700" onClick={() => review(r.id, "approved")} disabled={busyId === r.id}>Approve</Btn>
                        <Btn sm variant="danger-quiet" onClick={() => setRejecting(r)} disabled={busyId === r.id}>Reject</Btn>
                      </>
                    )}
                    <span className="ml-auto sm:ml-0">
                      <ActionMenu
                        label={`Attendance actions for ${r.intern_name}, ${r.attendance_date}`}
                        items={[
                          r.can_edit_times && { key: "correct", label: "Correct attendance", icon: "edit", onSelect: () => setEditing(r) },
                          r.can_delete && { key: "delete", label: "Delete this attendance", icon: "trash", danger: true, onSelect: () => askDelete(r) },
                        ]}
                      />
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && <LoadMore shown={records.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />}
      </Section>

      {editing && <EditTimesModal record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <ConfirmDialog
        open={!!rejecting}
        title="Reject this attendance?"
        confirmLabel="Reject attendance"
        onConfirm={() => { const record = rejecting; setRejecting(null); review(record.id, "rejected"); }}
        onCancel={() => setRejecting(null)}
      >
        <p>{rejecting?.intern_name}&apos;s attendance on {rejecting?.attendance_date} will be marked as rejected and the intern is told.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!checking}
        tone="primary"
        title="Mark this red flag as checked?"
        confirmLabel="Mark as checked"
        onConfirm={() => { const record = checking; setChecking(null); checkFlag(record.id); }}
        onCancel={() => setChecking(null)}
      >
        <p>{checking?.intern_name}&apos;s record on {checking?.attendance_date} stays red, but it will show that you checked it.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this attendance?"
        confirmLabel="Delete attendance"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      >
        {deleting && (
          <>
            <p>
              This deletes <strong>{deleting.intern_name}</strong>&apos;s attendance on <strong>{deleting.attendance_date}</strong>
              {deleting.session_label ? ` (${deleting.session_label.toLowerCase()})` : ""}
              {deleting.hours != null ? <> and removes its <strong>{deleting.hours} hours</strong> from their total</> : ""}.
              The photos are deleted and the intern is told. This cannot be undone.
            </p>
            <p>The automatic daily summary of that day is removed too, unless the intern edited it.</p>
            <FormField label="Reason (optional, shown to the intern)">
              <Input type="text" value={deleteReason} maxLength={255} onChange={(e) => setDeleteReason(e.target.value)} />
            </FormField>
          </>
        )}
      </ConfirmDialog>

      {showModal && (
        <LogAttendanceModal
          interns={interns}
          mode={mode}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </Page>
  );
}
