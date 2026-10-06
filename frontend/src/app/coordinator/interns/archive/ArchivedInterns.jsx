"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import Icon from "@/components/Icon";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Pagination, { PAGE_SIZE } from "@/components/Pagination";

import { inputProps } from "@/lib/inputRules";
function ArchivedRowMenu({ intern, onRestore, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="Archived intern actions"
        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        <Icon name="dots" size={16} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => { setOpen(false); onRestore(intern); }}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Restore (Mark Active)
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(intern); }}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Where an intern marked inactive from the main Interns screen ends up —
 * out of the active roster, but still on file (restore anytime, or delete
 * outright if destroyIntern()'s history check allows it).
 */
export default function ArchivedInterns() {
  const [interns, setInterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  function load() {
    setLoading(true);
    fetchCoordinatorData("interns")
      .then((r) => setInterns((r.interns ?? []).filter((i) => i.status === "inactive")))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleRestore(intern) {
    setBusyId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not restore intern.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    const intern = toDelete;
    if (!intern) return;
    setBusyId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete intern.");
      setToDelete(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const companyOptions = ["All", ...new Set(interns.map((i) => i.company_name).filter(Boolean))];
  const courseOptions = ["All", ...new Set(interns.map((i) => i.course).filter(Boolean))];
  const filtered = interns.filter((i) => {
    const matchesCompany = companyFilter === "All" || i.company_name === companyFilter;
    const matchesCourse = courseFilter === "All" || i.course === courseFilter;
    const matchesQuery =
      !query ||
      i.intern_name?.toLowerCase().includes(query.toLowerCase()) ||
      i.company_name?.toLowerCase().includes(query.toLowerCase());
    return matchesCompany && matchesCourse && matchesQuery;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/coordinator/interns" className="text-sm font-semibold text-blue-600 hover:underline">← Back to Interns</Link>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Archive</h2>
          <p className="mt-1 text-sm text-slate-600">Interns marked inactive — restore them anytime, or delete if no longer needed.</p>
        </div>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input {...inputProps("search")}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search by name or company…"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={companyFilter}
            onChange={(e) => { setCompanyFilter(e.target.value); setPage(1); }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            {companyOptions.map((c) => (
              <option key={c} value={c}>{c === "All" ? "All companies" : c}</option>
            ))}
          </select>
          <select
            value={courseFilter}
            onChange={(e) => { setCourseFilter(e.target.value); setPage(1); }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            {courseOptions.map((c) => (
              <option key={c} value={c}>{c === "All" ? "All courses" : c}</option>
            ))}
          </select>
        </div>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading archive…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {interns.length === 0 ? "Nothing archived — inactive interns will show up here." : "No archived interns match this filter."}
          </p>
        ) : (
          <>
            <div className="divide-y divide-slate-100 sm:hidden">
              {paginated.map((i) => (
                <div key={i.deployment_id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/coordinator/interns/${i.deployment_id}/report`} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline">
                        {i.intern_name}
                      </Link>
                      <p className="text-xs text-slate-500">{[i.student_number, i.course].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <ArchivedRowMenu intern={i} onRestore={handleRestore} onDelete={setToDelete} busy={busyId === i.deployment_id} />
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {i.company_name ?? "—"}
                    {i.supervisor_name && ` · Supervisor: ${i.supervisor_name}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{i.hours_completed}h / {i.required_hours}h</p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Intern</th>
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Hours</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginated.map((i) => (
                    <tr key={i.deployment_id} className="align-top">
                      <td className="px-5 py-4">
                        <Link href={`/coordinator/interns/${i.deployment_id}/report`} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline">
                          {i.intern_name}
                        </Link>
                        <p className="text-xs text-slate-500">{[i.student_number, i.course].filter(Boolean).join(" · ") || "—"}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {i.company_name ?? "—"}
                        {i.supervisor_name && <p className="text-xs text-slate-400">Supervisor: {i.supervisor_name}</p>}
                      </td>
                      <td className="px-5 py-4 text-slate-700">{i.hours_completed}h / {i.required_hours}h</td>
                      <td className="px-5 py-4 text-right">
                        <ArchivedRowMenu intern={i} onRestore={handleRestore} onDelete={setToDelete} busy={busyId === i.deployment_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </section>
      <ConfirmDialog open={!!toDelete} title={`Delete ${toDelete?.intern_name}?`} confirmLabel="Delete intern" busy={busyId !== null} error={error} onConfirm={handleDelete} onCancel={() => setToDelete(null)}>
        <p>This removes their account and deployment for good and can&apos;t be undone. It only works while they have no attendance, tasks, evaluations or documents on file.</p>
      </ConfirmDialog>
    </div>
  );
}
