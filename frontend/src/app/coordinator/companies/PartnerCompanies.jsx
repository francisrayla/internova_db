"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Add a partner company</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Company name</span>
            <input value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" placeholder="e.g. ABC Technologies" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Address</span>
            <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact email</span>
              <input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Contact number</span>
              <input value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
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

export default function PartnerCompanies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    setLoading(true);
    fetchCoordinatorData("companies")
      .then((r) => setCompanies(r.companies ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const statuses = ["All", ...new Set(companies.map((c) => c.status))];
  const filtered = companies.filter((c) => {
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    const matchesQuery = !query || c.company_name?.toLowerCase().includes(query.toLowerCase());
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Partner Companies</h2>
          <p className="mt-1 text-sm text-slate-600">Companies your interns can be deployed to. Open a company to see its supervisors and interns.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Add company
        </button>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies by name…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-blue-500"
          >
            {statuses.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading companies…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {companies.length === 0 ? "No partner companies yet. Add one to start deploying interns." : "No companies match this filter."}
          </p>
        ) : (
          filtered.map((c) => (
            <Link
              key={c.id}
              href={`/coordinator/companies/${c.id}`}
              className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900">{c.company_name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${c.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{c.status}</span>
                </div>
                <p className="text-xs text-slate-500">{c.company_code}{c.address ? ` · ${c.address}` : ""}</p>
                <p className="text-xs text-slate-400">{c.contact_email ?? "—"}{c.contact_number ? ` · ${c.contact_number}` : ""}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-500">{c.active_interns_count} active intern{c.active_interns_count === 1 ? "" : "s"}</span>
                <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-blue-600">View →</span>
              </div>
            </Link>
          ))
        )}
      </section>

      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}
