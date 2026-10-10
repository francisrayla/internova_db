"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { useUrlTab } from "@/lib/useUrlTab";
import AddInternModal from "@/components/AddInternModal";
import Icon from "@/components/Icon";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, Chip, Chips, DataList, DataRow, FilterBar, FormField, Input, Page, PageHeader, SearchField, Section, SheetFrame, TabStrip } from "@/components/dash/page";
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
    <SheetFrame
      onClose={onClose}
      title="Edit company"
      zIndex={60}
      onSubmit={(e) => { e.preventDefault(); save(); }}
      footer={
        <>
          <Btn variant="danger-quiet" className="sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={saving}>Delete</Btn>
          <Btn onClick={() => save({ status: company.status === "active" ? "inactive" : "active" })} disabled={saving}>
            {company.status === "active" ? "Mark inactive" : "Mark active"}
          </Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
        </>
      }
    >
      <ConfirmDialog open={confirmDelete} title={`Delete ${company.company_name}?`} confirmLabel="Delete company" busy={saving} error={error} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)}>
        <p>This removes the company for good and can&apos;t be undone. A company that still has supervisors, interns or transfer history can&apos;t be deleted &mdash; mark it inactive instead.</p>
      </ConfirmDialog>
      <div className="space-y-4">
        <FormField label="Company name">
          <Input {...inputProps("orgName")} value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} />
        </FormField>
        <FormField label="Address">
          <Input {...inputProps("address")} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <EmailField
            label="Contact email"
            value={form.contact_email}
            onChange={(contact_email) => { setForm((f) => ({ ...f, contact_email })); setEmailError(""); }}
            serverError={emailError}
            showErrors={attempted}
          />
          <FormField label="Contact number">
            <Input {...inputProps("phone")} type="tel" value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: clean("phone", e.target.value) }))} />
          </FormField>
        </div>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
    <div className="dash-fig">
      <span className="dash-fig-label">{label}</span>
      <span className="dash-fig-value">{value}</span>
      {note && <span className="dash-fig-note">{note}</span>}
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
    return <Page><SkeletonList rows={3} height="h-28" /></Page>;
  }

  if (error || !data) {
    return (
      <Page>
        <PageHeader title="Company" back={{ href: "/coordinator/companies", label: "Back to Companies" }} />
        <ErrorNote onRetry={load}>{error || "Company not found."}</ErrorNote>
      </Page>
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
    <Page>
      <PageHeader
        back={{ href: "/coordinator/companies", label: "Back to Companies" }}
        title={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"><span className="break-words">{company.company_name}</span><Pill tone={company.status === "active" ? "green" : "slate"}>{company.status === "active" ? "Active" : "Inactive"}</Pill></span>}
        sentence={company.company_code}
        meta={<span className="break-words">{location} · {contact || "No contact details yet"}</span>}
      >
        <Btn onClick={() => setEditingCompany(true)}>
          <Icon name="edit" size={15} /> Edit
        </Btn>
      </PageHeader>

      <div className="dash-strip" style={{ "--cols": 3 }}>
        <Stat label="Supervisors" value={`${supervisors.length} of ${MAX_SUPERVISORS}`} note={atLimit ? "Full" : "Room for more"} />
        <Stat label="Active interns" value={summary.active ?? 0} note={summary.invitation_pending ? `${summary.invitation_pending} invitation pending` : undefined} />
        <Stat label="Completed" value={summary.completed ?? 0} />
      </div>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {actionError && <Banner tone="red" onDismiss={() => setActionError("")}>{actionError}</Banner>}

      <TabStrip
        label="Company sections"
        tabs={[
          { key: "supervisors", label: "Supervisors", count: supervisors.length },
          { key: "interns", label: "Interns", count: interns.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "supervisors" && (
        <Section
          title="Supervisors"
          help="They log and approve your interns' attendance and tasks."
          flush
          action={
            !atLimit && (
              <Btn variant="primary" sm onClick={() => setShowAddSupervisor(true)}>
                <Icon name="plus" size={15} /> Add supervisor
              </Btn>
            )
          }
        >
          {atLimit && (
            <div className="k-pad pb-0">
              <p className="k-note">This company already has its {MAX_SUPERVISORS} supervisors. Edit one to replace them.</p>
            </div>
          )}
          {supervisors.length === 0 ? (
            <div className="k-pad">
              <EmptyState
                icon="user"
                title="No supervisors yet"
                text="Add a supervisor so interns here can log attendance and get their work reviewed."
                action={<Btn variant="primary" onClick={() => setShowAddSupervisor(true)}>Add supervisor</Btn>}
              />
            </div>
          ) : (
            <DataList>
              {supervisors.map((s) => (
                <SupervisorCard key={s.user_id} supervisor={s} showCompany={false} menuItems={supervisorActions.menuFor(s)} />
              ))}
            </DataList>
          )}
        </Section>
      )}

      {tab === "interns" && (
        <Section
          title="Interns deployed here"
          flush
          action={
            company.status === "active" && (
              <Btn variant="primary" sm onClick={() => setShowAddIntern(true)}>
                <Icon name="plus" size={15} /> Add intern
              </Btn>
            )
          }
        >
          {(interns.length > 0 || transferredOut.length > 0) && (
            <div className="k-pad pb-0">
              <FilterBar>
                <SearchField
                  {...inputProps("search")}
                  value={internQuery}
                  onChange={(e) => setInternQuery(e.target.value)}
                  placeholder="Search interns by name…"
                  aria-label="Search interns"
                />
                <Chips label="Filter by status">
                  {filters.map((f) => (
                    <Chip key={f.key} on={internFilter === f.key} onClick={() => setInternFilter(f.key)}>{f.label}</Chip>
                  ))}
                </Chips>
              </FilterBar>
            </div>
          )}
          {showingTransferred ? (
            <>
              <p className="k-pad pb-0 text-xs text-slate-600">These interns were moved to another company. Their earlier hours and records stay with them.</p>
              {filteredTransferred.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-slate-500">No one matches your search.</p>
              ) : (
                <DataList>
                  {filteredTransferred.map((i) => (
                    <DataRow
                      key={i.deployment_id}
                      wrap
                      href={`/coordinator/interns/${i.deployment_id}/report`}
                      lead={<Avatar name={i.intern_name} size={36} />}
                      title={i.intern_name}
                      sub={`Now at ${i.transferred_to ?? "another company"}${i.moved_on ? ` since ${new Date(i.moved_on + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`}
                      side={<Pill tone="slate" size="sm">Transferred out</Pill>}
                    />
                  ))}
                </DataList>
              )}
            </>
          ) : interns.length === 0 ? (
            <div className="k-pad">
              <EmptyState
                icon="users"
                title="No interns deployed here yet"
                text={company.status === "active" ? "Add an intern to deploy them to this company." : "This company is inactive. Mark it active to deploy interns here."}
              />
            </div>
          ) : filteredInterns.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No interns match these filters.</p>
          ) : (
            <InternRoster interns={filteredInterns} menuFor={internActions.menuFor} showCompany={false} />
          )}
        </Section>
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
    </Page>
  );
}
