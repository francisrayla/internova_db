"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { useUrlTab } from "@/lib/useUrlTab";
import AddInternModal from "@/components/AddInternModal";
import Icon from "@/components/Icon";
import { Avatar, Banner, BackLink, EmptyState, ErrorNote, Pill, SectionTitle, SkeletonList, TabBar } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InternRoster from "@/components/coordinator/InternRoster";
import SupervisorCard from "@/components/coordinator/SupervisorCard";
import useInternActions from "@/components/coordinator/useInternActions";
import useSupervisorActions from "@/components/coordinator/useSupervisorActions";
import { AddSupervisorModal, MAX_SUPERVISORS } from "@/components/coordinator/SupervisorModals";
import { clean, inputProps } from "@/lib/inputRules";
import EmailField from "@/components/EmailField";
import { emailProblem, normalizeEmail, serverFieldError } from "@/lib/emailCheck";

function EditCompanyModal({ company, onClose, onSaved, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    company_name: company.company_name ?? "",
    address: company.address ?? "",
    contact_email: company.contact_email ?? "",
    contact_number: company.contact_number ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);

  async function save(extra = {}) {
    // Only a changed address is checked, so an older saved one never blocks other edits.
    const emailChanged = normalizeEmail(form.contact_email) !== (company.contact_email ?? "").toLowerCase();
    if (emailChanged) {
      setAttempted(true);
      if (emailProblem(form.contact_email)) return setError("");
    }
    setSaving(true);
    setError("");
    setEmailError("");
    try {
      const res = await apiFetch(`/api/coordinator/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, contact_email: emailChanged ? normalizeEmail(form.contact_email) : company.contact_email ?? "", ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const fieldMessage = serverFieldError(data, "contact_email");
        if (fieldMessage) {
          setEmailError(fieldMessage);
          setSaving(false);
          return;
        }
        throw new Error(data.message || "Could not update company.");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/companies/${company.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete company.");
      onDeleted();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-overlay fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-black/50 backdrop-blur-sm sm:p-4">
      <div className="sheet-panel w-full max-w-md rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Edit company</h3>
        <ConfirmDialog open={confirmDelete} title={`Delete ${company.company_name}?`} confirmLabel="Delete company" busy={saving} error={error} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)}>
          <p>This removes the company for good and can&apos;t be undone. A company that still has supervisors, interns or transfer history can&apos;t be deleted &mdash; mark it inactive instead.</p>
        </ConfirmDialog>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Company name</span>
            <input {...inputProps("orgName")} value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Address</span>
            <input {...inputProps("address")} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <EmailField
              label="Contact email"
              value={form.contact_email}
              onChange={(contact_email) => { setForm((f) => ({ ...f, contact_email })); setEmailError(""); }}
              serverError={emailError}
              showErrors={attempted}
            />
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact number</span>
              <input {...inputProps("phone")} type="tel" value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: clean("phone", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-2">
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => save({ status: company.status === "active" ? "inactive" : "active" })}
                disabled={saving}
                className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {company.status === "active" ? "Mark inactive" : "Mark active"}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const INTERN_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "invitation_pending", label: "Invitation pending" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "completed", label: "Completed" },
];

function internMatches(i, filter) {
  if (filter === "all") return true;
  if (filter === "needs_attention") return (i.attention ?? []).length > 0;
  return i.display_status === filter;
}

function Stat({ label, value, note }) {
  return (
    <div className="min-w-0 rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="truncate text-sm font-semibold text-slate-700">{label}</p>
      {note && <p className="truncate text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [tab, setTab] = useUrlTab(["supervisors", "interns"], "supervisors");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const [internQuery, setInternQuery] = useState("");
  const [internFilter, setInternFilter] = useState("all");

  const [editingCompany, setEditingCompany] = useState(false);
  const [showAddSupervisor, setShowAddSupervisor] = useState(false);
  const [showAddIntern, setShowAddIntern] = useState(false);

  function fetchAll() {
    fetchCoordinatorData(`companies/${id}`)
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // First load happens with loading already true; later reloads show the skeleton again.
  function load() {
    setLoading(true);
    fetchAll();
  }

  useEffect(fetchAll, [id]);

  const callbacks = {
    reload: load,
    onNotice: (m) => { setActionError(""); setNotice(m); },
    onError: (m) => { setNotice(""); setActionError(m); },
  };
  const internActions = useInternActions(callbacks);
  const supervisorActions = useSupervisorActions(callbacks);

  if (loading && !data) {
    return <SkeletonList rows={3} height="h-28" />;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink href="/coordinator/companies">&larr; Back to Companies</BackLink>
        <ErrorNote onRetry={load}>{error || "Company not found."}</ErrorNote>
      </div>
    );
  }

  const { company, supervisors, interns } = data;
  const transferredOut = data.transferred_out ?? [];
  const summary = data.summary ?? {};
  const atLimit = supervisors.length >= MAX_SUPERVISORS;
  const q = internQuery.trim().toLowerCase();
  const filters = transferredOut.length > 0 ? [...INTERN_FILTERS, { key: "transferred_out", label: `Transferred out (${transferredOut.length})` }] : INTERN_FILTERS;
  const showingTransferred = internFilter === "transferred_out";
  const filteredTransferred = transferredOut.filter((i) => !q || [i.intern_name, i.student_number, i.company_name].some((v) => v?.toLowerCase().includes(q)));
  const filteredInterns = interns.filter(
    (i) => internMatches(i, internFilter) && (!q || [i.intern_name, i.student_number, i.supervisor_name].some((v) => v?.toLowerCase().includes(q)))
  );
  const location = company.address || "No address yet";
  const contact = [company.contact_email, company.contact_number].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <BackLink href="/coordinator/companies">&larr; Back to Companies</BackLink>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar name={company.company_name} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-base font-semibold text-slate-900">{company.company_name}</h2>
              <Pill tone={company.status === "active" ? "green" : "slate"}>{company.status === "active" ? "Active" : "Inactive"}</Pill>
            </div>
            <p className="truncate text-xs text-slate-500">{company.company_code}</p>
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
              <Icon name="location" size={14} />
              <span className="truncate" title={location}>{location}</span>
            </p>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
              <Icon name="mail" size={14} />
              <span className="truncate" title={contact}>{contact || "No contact details yet"}</span>
            </p>
          </div>
          <button type="button" onClick={() => setEditingCompany(true)} className="shrink-0 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <Stat label="Supervisors" value={`${supervisors.length} of ${MAX_SUPERVISORS}`} note={atLimit ? "Full" : "Room for more"} />
          <Stat label="Active interns" value={summary.active ?? 0} note={summary.invitation_pending ? `${summary.invitation_pending} invitation pending` : undefined} />
          <Stat label="Completed" value={summary.completed ?? 0} />
        </div>
      </section>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {actionError && <Banner tone="red" onDismiss={() => setActionError("")}>{actionError}</Banner>}

      <TabBar
        tabs={[
          { key: "supervisors", label: "Supervisors", count: supervisors.length },
          { key: "interns", label: "Interns", count: interns.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "supervisors" && (
        <section className="space-y-3">
          <SectionTitle
            title="Supervisors"
            help="They log and approve your interns' attendance and tasks."
            action={
              !atLimit && (
                <button type="button" onClick={() => setShowAddSupervisor(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  <Icon name="plus" size={15} /> Add supervisor
                </button>
              )
            }
          />
          {atLimit && (
            <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
              This company already has its {MAX_SUPERVISORS} supervisors. Edit one to replace them.
            </p>
          )}
          {supervisors.length === 0 ? (
            <EmptyState
              icon="user"
              title="No supervisors yet"
              text="Add a supervisor so interns here can log attendance and get their work reviewed."
              action={<button type="button" onClick={() => setShowAddSupervisor(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add supervisor</button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {supervisors.map((s) => (
                <SupervisorCard key={s.user_id} supervisor={s} showCompany={false} menuItems={supervisorActions.menuFor(s)} />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "interns" && (
        <section className="space-y-3">
          <SectionTitle
            title="Interns deployed here"
            action={
              company.status === "active" && (
                <button type="button" onClick={() => setShowAddIntern(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  <Icon name="plus" size={15} /> Add intern
                </button>
              )
            }
          />
          {(interns.length > 0 || transferredOut.length > 0) && (
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <input
                {...inputProps("search")}
                value={internQuery}
                onChange={(e) => setInternQuery(e.target.value)}
                placeholder="Search interns by name…"
                aria-label="Search interns"
                className="w-full min-w-0 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-sm"
              />
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setInternFilter(f.key)}
                    aria-pressed={internFilter === f.key}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      internFilter === f.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showingTransferred ? (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">These interns were moved to another company. Their earlier hours and records stay with them.</p>
              {filteredTransferred.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-slate-500">No one matches your search.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredTransferred.map((i) => (
                    <li key={i.deployment_id} className="flex items-center gap-2.5 p-3">
                      <Avatar name={i.intern_name} size={36} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/coordinator/interns/${i.deployment_id}/report`} className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-600 hover:underline">{i.intern_name}</Link>
                        <p className="truncate text-xs text-slate-500">Now at {i.transferred_to ?? "another company"}{i.moved_on ? ` since ${new Date(i.moved_on + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</p>
                      </div>
                      <Pill tone="slate" size="sm" className="shrink-0">Transferred out</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : interns.length === 0 ? (
            <EmptyState
              icon="users"
              title="No interns deployed here yet"
              text={company.status === "active" ? "Add an intern to deploy them to this company." : "This company is inactive. Mark it active to deploy interns here."}
            />
          ) : filteredInterns.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">No interns match these filters.</p>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <InternRoster interns={filteredInterns} menuFor={internActions.menuFor} showCompany={false} />
            </div>
          )}
        </section>
      )}

      {internActions.dialogs}
      {supervisorActions.dialogs}
      {editingCompany && (
        <EditCompanyModal
          company={company}
          onClose={() => setEditingCompany(false)}
          onSaved={() => { setEditingCompany(false); setNotice("Company updated."); load(); }}
          onDeleted={() => router.push("/coordinator/companies")}
        />
      )}
      {showAddSupervisor && (
        <AddSupervisorModal
          companyId={id}
          companyName={company.company_name}
          onClose={() => setShowAddSupervisor(false)}
          onSaved={() => { setShowAddSupervisor(false); setNotice("Supervisor added."); load(); }}
        />
      )}
      {showAddIntern && (
        <AddInternModal
          lockedCompanyId={id}
          lockedCompanyName={company.company_name}
          onClose={() => setShowAddIntern(false)}
          onSaved={() => { setShowAddIntern(false); setNotice("Intern added. They will get an email invitation."); load(); }}
        />
      )}
    </div>
  );
}
