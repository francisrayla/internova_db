"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import Icon from "@/components/Icon";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, Chip, Chips, DataList, DataRow, FilterBar, FormField, Input, Page, PageHeader, SearchField, Section, SheetFrame } from "@/components/dash/page";

import { clean, inputProps } from "@/lib/inputRules";
import EmailField from "@/components/EmailField";
import { emailProblem, normalizeEmail, serverFieldError } from "@/lib/emailCheck";
function AddCompanyModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ company_name: "", address: "", contact_email: "", contact_number: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [attempted, setAttempted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setAttempted(true);
    if (!form.company_name.trim()) return setError("Enter a company name.");
    if (emailProblem(form.contact_email)) return setError("");
    setSaving(true);
    setError("");
    setEmailError("");
    try {
      const res = await apiFetch("/api/coordinator/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, contact_email: normalizeEmail(form.contact_email) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const fieldMessage = serverFieldError(data, "contact_email");
        if (fieldMessage) return setEmailError(fieldMessage);
        throw new Error(data.message || "Could not add company.");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      onClose={onClose}
      title="Add a partner company"
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Adding…" : "Add company"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Company name">
          <Input {...inputProps("orgName")} value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} placeholder="e.g. ABC Technologies" />
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

const STATUS_CHIPS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

function CompanyRow({ c }) {
  const sup = c.supervisors_count ?? 0;
  const location = c.address || "No address yet";
  const contact = [c.contact_email, c.contact_number].filter(Boolean).join(" · ");
  return (
    <DataRow
      wrap
      href={`/coordinator/companies/${c.id}`}
      lead={<Avatar name={c.company_name} size={40} />}
      title={<><span className="break-words">{c.company_name}</span>{c.company_code && <span className="ml-2 text-xs font-normal text-slate-500">{c.company_code}</span>}</>}
      sub={
        <>
          <span className="flex min-w-0 items-center gap-1.5"><Icon name="location" size={14} className="shrink-0" /><span className="break-words">{location}</span></span>
          <span className="flex min-w-0 items-center gap-1.5"><Icon name="mail" size={14} className="shrink-0" /><span className="min-w-0 break-words">{contact || "No contact details yet"}</span></span>
          <span className="mt-0.5 block">
            <span className={sup === 0 ? "font-semibold text-amber-700" : ""}>{sup === 0 ? "No supervisors yet" : `${sup} of 2 supervisors`}</span>
            {" · "}
            <span className="font-semibold text-slate-900">{c.active_interns_count}</span> active intern{c.active_interns_count === 1 ? "" : "s"}
          </span>
        </>
      }
      side={<Pill tone={c.status === "active" ? "green" : "slate"}>{c.status === "active" ? "Active" : "Inactive"}</Pill>}
    />
  );
}

export default function PartnerCompanies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);

  function fetchAll() {
    fetchCoordinatorData("companies")
      .then((r) => { setCompanies(r.companies ?? []); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // First load happens with loading already true; later reloads show the skeleton again.
  function load() {
    setLoading(true);
    fetchAll();
  }

  useEffect(fetchAll, []);

  const filtered = companies.filter((c) => {
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [c.company_name, c.address, c.company_code].some((v) => v?.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  return (
    <Page>
      <PageHeader title="Partner Companies" sentence="Companies your interns can be deployed to. Open a company to see its supervisors and interns.">
        <Btn variant="primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> Add company
        </Btn>
      </PageHeader>

      {companies.length > 0 && (
        <FilterBar>
          <SearchField
            {...inputProps("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies by name or address…"
            aria-label="Search companies"
          />
          <Chips label="Filter by status">
            {STATUS_CHIPS.map((s) => (
              <Chip key={s.key} on={statusFilter === s.key} onClick={() => setStatusFilter(s.key)}>{s.label}</Chip>
            ))}
          </Chips>
        </FilterBar>
      )}

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : companies.length === 0 ? (
          <div className="k-pad">
            <EmptyState
              icon="building"
              title="No partner companies yet"
              text="Add the companies where your interns will be deployed. Once a company is added, you can give it supervisors and start deploying interns."
              action={<Btn variant="primary" onClick={() => setShowAdd(true)}>Add your first company</Btn>}
            />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">No companies match these filters.</p>
        ) : (
          <DataList>
            {filtered.map((c) => <CompanyRow key={c.id} c={c} />)}
          </DataList>
        )}
      </Section>

      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setNotice("Company added."); load(); }} />}
    </Page>
  );
}
