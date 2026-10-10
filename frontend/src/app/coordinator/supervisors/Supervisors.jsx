"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { inputProps } from "@/lib/inputRules";
import Icon from "@/components/Icon";
import { Banner, EmptyState, ErrorNote, SkeletonList } from "@/components/ui";
import { Btn, Chip, Chips, DataList, FilterBar, Page, PageHeader, SearchField, Section } from "@/components/dash/page";
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
    <Page>
      <PageHeader title="Supervisors" sentence="Everyone who supervises your interns, across all partner companies. Each company can have up to 2.">
        <Btn variant="primary" onClick={() => setChoosing(true)}>
          <Icon name="plus" size={15} /> Add supervisor
        </Btn>
      </PageHeader>

      <FilterBar>
        <SearchField
          {...inputProps("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or company…"
          aria-label="Search supervisors"
        />
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company" className="k-input sm:w-auto sm:max-w-[16rem]">
          <option value="All">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <Chips label="Filter by status">
          {STATUS_CHIPS.map((c) => (
            <Chip key={c.key} on={status === c.key} onClick={() => setStatus(c.key)}>{c.label}</Chip>
          ))}
        </Chips>
      </FilterBar>

      {notice && <Banner tone="green" onDismiss={() => setNotice("")}>{notice}</Banner>}
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}

      <Section flush>
        {loading ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : supervisors.length === 0 ? (
          <div className="k-pad">
            <EmptyState
              icon="users"
              title="No supervisors yet"
              text="Supervisors log and approve your interns' attendance and tasks. Add one to a partner company to get started."
              action={
                companies.length === 0 ? (
                  <Btn variant="primary" href="/coordinator/companies">Add a company first</Btn>
                ) : (
                  <Btn variant="primary" onClick={() => setChoosing(true)}>Add supervisor</Btn>
                )
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">No supervisors match these filters.</p>
        ) : (
          <DataList>
            {filtered.map((s) => (
              <SupervisorCard key={s.user_id} supervisor={s} menuItems={menuFor(s, { showOpenCompany: true })} />
            ))}
          </DataList>
        )}
      </Section>

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
    </Page>
  );
}
