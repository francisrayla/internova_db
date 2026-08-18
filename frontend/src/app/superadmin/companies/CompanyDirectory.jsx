"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCompanies() {
      try {
        const response = await fetchSuperadminData("companies");
        setCompanies(response.companies ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    loadCompanies();
  }, []);

  const filteredCompanies = useMemo(() => {
    return companies.filter((company) => {
      const matchesStatus = statusFilter === "All" || company.status === statusFilter;
      const matchesQuery = company.name.toLowerCase().includes(query.toLowerCase());
      return matchesStatus && matchesQuery;
    });
  }, [companies, query, statusFilter]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
            >
              <option>All</option>
              <option>Verified</option>
              <option>Pending</option>
            </select>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {loading ? <p className="text-sm text-slate-600">Loading companies…</p> : null}
        {!loading && filteredCompanies.map((company) => (
          <div key={company.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">{company.name}</p>
            <p className="mt-2 text-sm text-slate-600">Tier: {company.tier}</p>
            <div className="mt-4 inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{company.status}</div>
            <button className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">Review account</button>
          </div>
        ))}
      </section>
    </div>
  );
}
