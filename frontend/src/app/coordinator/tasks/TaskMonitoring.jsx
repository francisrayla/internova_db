"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

function CompanyCard({ company, activeCount, totalCount }) {
  return (
    <Link
      href={`/coordinator/tasks/company/${company.id}`}
      className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
    >
      <div>
        <h3 className="font-semibold text-slate-900">{company.company_name}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {totalCount} task{totalCount === 1 ? "" : "s"} total
          {activeCount > 0 ? ` · ${activeCount} active` : ""}
        </p>
      </div>
      <span className="text-slate-300">→</span>
    </Link>
  );
}

/**
 * Coordinators are view-only for tasks — supervisors assign and manage the
 * actual work. Since one coordinator's interns are spread across many
 * companies, this screen is just an index: pick a company, then see (and
 * search/filter) its tasks on the next screen — never one giant list mixing
 * every company together.
 */
export default function TaskMonitoring() {
  const [tasks, setTasks] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetchCoordinatorData("tasks")
      .then((r) => {
        setTasks(r.tasks ?? []);
        setCompanies(r.companies ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const countsByCompany = useMemo(() => {
    const counts = {};
    for (const t of tasks) {
      const bucket = (counts[t.company_id] ??= { total: 0, active: 0 });
      bucket.total += 1;
      if (!(t.status === "completed" && t.evaluation)) bucket.active += 1;
    }
    return counts;
  }, [tasks]);

  const visibleCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.company_name?.toLowerCase().includes(q));
  }, [companies, search]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
        <p className="mt-1 text-sm text-slate-600">Pick a company to see the tasks for its interns — supervisors assign and manage the actual work.</p>
      </div>

      {companies.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </section>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading companies…</p>
      ) : companies.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No companies with deployed interns yet.</p>
      ) : visibleCompanies.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400 shadow-sm">No companies match your search.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleCompanies.map((c) => (
            <CompanyCard key={c.id} company={c} activeCount={countsByCompany[c.id]?.active ?? 0} totalCount={countsByCompany[c.id]?.total ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
