"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { inputProps } from "@/lib/inputRules";
import Icon from "@/components/Icon";
import { Banner, EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import SupervisorCard from "@/components/coordinator/SupervisorCard";
import useSupervisorActions from "@/components/coordinator/useSupervisorActions";
import { AddSupervisorModal, ChooseCompanyDialog } from "@/components/coordinator/SupervisorModals";

const STATUS_CHIPS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Invitation pending" },
  { key: "bounced", label: "Email bounced" },
];

export default function Supervisors() {
  const [supervisors, setSupervisors] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [status, setStatus] = useState("all");
  const [choosing, setChoosing] = useState(false);
  const [addingFor, setAddingFor] = useState(null);

  function fetchAll() {
    Promise.all([fetchCoordinatorData("supervisors"), fetchCoordinatorData("companies")])
      .then(([s, c]) => {
        setSupervisors(s.supervisors ?? []);
        setCompanies(c.companies ?? []);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // First load happens with loading already true; later reloads show the skeleton again.
  function load() {
    setLoading(true);
    fetchAll();
  }

  useEffect(fetchAll, []);

  const { menuFor, dialogs } = useSupervisorActions({
    reload: load,
    onNotice: (m) => { setError(""); setNotice(m); },
    onError: (m) => { setNotice(""); setError(m); },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return supervisors.filter(
      (s) =>
        (status === "all" || s.status === status) &&
        (companyFilter === "All" || String(s.company_id) === companyFilter) &&
        (!q || [s.name, s.email, s.company_name, s.position].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [supervisors, query, status, companyFilter]);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">Supervisors</h2>
          <button type="button" onClick={() => setChoosing(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Icon name="plus" size={15} /> Add supervisor
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">Everyone who supervises your interns, across all partner companies. Each company can have up to 2.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            {...inputProps("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or company…"
            aria-label="Search supervisors"
            className="w-full min-w-0 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-sm"
          />
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company" className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:w-auto sm:max-w-[16rem]">
            <option value="All">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatus(c.key)}
              aria-pressed={status === c.key}
              className={`rounded-full border px-3 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                status === c.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={3} height="h-32" />
      ) : supervisors.length === 0 ? (
        <EmptyState
          icon="users"
          title="No supervisors yet"
          text="Supervisors log and approve your interns' attendance and tasks. Add one to a partner company to get started."
          action={
            companies.length === 0 ? (
              <Link href="/coordinator/companies" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add a company first</Link>
            ) : (
              <button type="button" onClick={() => setChoosing(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add supervisor</button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">No supervisors match these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((s) => (
            <SupervisorCard key={s.user_id} supervisor={s} menuItems={menuFor(s, { showOpenCompany: true })} />
          ))}
        </div>
      )}

      {dialogs}
      {choosing && (
        <ChooseCompanyDialog
          companies={companies}
          onClose={() => setChoosing(false)}
          onChoose={(c) => { setChoosing(false); setAddingFor(c); }}
        />
      )}
      {addingFor && (
        <AddSupervisorModal
          companyId={addingFor.id}
          companyName={addingFor.company_name}
          onClose={() => setAddingFor(null)}
          onSaved={() => { setAddingFor(null); setNotice("Supervisor added."); load(); }}
        />
      )}
    </div>
  );
}
