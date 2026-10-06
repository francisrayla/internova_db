"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import Icon from "@/components/Icon";
import { Avatar, Banner, EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";

import { clean, inputProps } from "@/lib/inputRules";
function AddCompanyModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ company_name: "", address: "", contact_email: "", contact_number: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) return setError("Enter a company name.");
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/coordinator/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not add company.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">Add a partner company</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Company name</span>
            <input {...inputProps("orgName")} value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. ABC Technologies" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Address</span>
            <input {...inputProps("address")} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact email</span>
              <input {...inputProps("email")} type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: clean("email", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact number</span>
              <input {...inputProps("phone")} type="tel" value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: clean("phone", e.target.value) }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Adding…" : "Add company"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_CHIPS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

function CompanyCard({ c }) {
  const sup = c.supervisors_count ?? 0;
  const names = c.supervisor_names ?? [];
  const location = c.address || "No address yet";
  const contact = [c.contact_email, c.contact_number].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/coordinator/companies/${c.id}`}
      className="block min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm outline-none transition hover:border-blue-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="flex items-start gap-3">
        <Avatar name={c.company_name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-semibold text-slate-900" title={c.company_name}>{c.company_name}</p>
            <Pill tone={c.status === "active" ? "green" : "slate"} className="shrink-0">{c.status === "active" ? "Active" : "Inactive"}</Pill>
          </div>
          <p className="truncate text-xs text-slate-500">{c.company_code}</p>
        </div>
      </div>

      <p className="mt-3 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
        <Icon name="location" size={14} />
        <span className="truncate" title={location}>{location}</span>
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
        <Icon name="mail" size={14} />
        <span className="truncate" title={contact}>{contact || "No contact details yet"}</span>
      </p>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex -space-x-2">
            {names.slice(0, 2).map((n, idx) => (
              <span key={idx} className="rounded-full ring-2 ring-white"><Avatar name={n} size={28} /></span>
            ))}
          </div>
          <span className={`truncate text-xs font-semibold ${sup === 0 ? "text-amber-700" : "text-slate-600"}`}>
            {sup === 0 ? "No supervisors yet" : `${sup} of 2 supervisors`}
          </span>
        </div>
        <span className="shrink-0 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{c.active_interns_count}</span> active intern{c.active_interns_count === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
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
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">Partner Companies</h2>
          <button onClick={() => setShowAdd(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Icon name="plus" size={15} /> Add company
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">Companies your interns can be deployed to. Open a company to see its supervisors and interns.</p>
      </div>

      {companies.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            {...inputProps("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies by name or address…"
            aria-label="Search companies"
            className="w-full min-w-0 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {STATUS_CHIPS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                aria-pressed={statusFilter === s.key}
                className={`rounded-full border px-3 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  statusFilter === s.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={3} height="h-36" />
      ) : companies.length === 0 ? (
        <EmptyState
          icon="building"
          title="No partner companies yet"
          text="Add the companies where your interns will be deployed. Once a company is added, you can give it supervisors and start deploying interns."
          action={<button onClick={() => setShowAdd(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add your first company</button>}
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">No companies match these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => <CompanyCard key={c.id} c={c} />)}
        </div>
      )}

      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setNotice("Company added."); load(); }} />}
    </div>
  );
}
