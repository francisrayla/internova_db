"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import AddInternModal from "@/components/AddInternModal";
import FixEmailModal from "@/components/FixEmailModal";
import Icon from "@/components/Icon";
import Pagination, { PAGE_SIZE } from "@/components/Pagination";

import { inputProps } from "@/lib/inputRules";
const STATUS_STYLES = {
  active: "bg-emerald-100 text-emerald-700",
  inactive: "bg-orange-100 text-orange-700",
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  terminated: "bg-red-100 text-red-700",
};

function ProgressBar({ pct, tone = "blue" }) {
  const bar = { blue: "bg-blue-600", emerald: "bg-emerald-600" }[tone] ?? "bg-blue-600";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

/**
 * Row-level actions menu — a coordinator needs a middle ground between
 * "leave as is" and "delete", since destroyIntern() refuses to delete an
 * intern who already has attendance/task/evaluation/document history (most
 * of them, in practice). Marking inactive covers that case without losing
 * anything.
 */
function InternRowMenu({ intern, onToggleStatus, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const canToggle = intern.status === "active" || intern.status === "inactive";
  const nextStatus = intern.status === "active" ? "inactive" : "active";

  return (
    <div className="relative inline-block text-left" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="Intern actions"
        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        <Icon name="dots" size={16} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {canToggle && (
            <button
              type="button"
              onClick={() => { setOpen(false); onToggleStatus(intern, nextStatus); }}
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {nextStatus === "inactive" ? "Mark as Inactive" : "Mark as Active"}
            </button>
          )}
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

export default function InternMonitoring() {
  const [interns, setInterns] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [resent, setResent] = useState(null);
  const [fixingIntern, setFixingIntern] = useState(null);
  const [fixed, setFixed] = useState(null);

  async function handleResend(intern) {
    setResendingId(intern.intern_id);
    setError("");
    setResent(null);
    try {
      const res = await apiFetch(`/api/coordinator/users/${intern.intern_id}/resend-invitation`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not resend the invitation.");
      setResent(intern.intern_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setResendingId(null);
    }
  }

  // Shown instead of "Invite pending" when the mail provider reported the
  // invitation bounced — the address needs fixing before resending helps.
  function bouncedNotice(intern) {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-red-600">
        <span className="rounded-full bg-red-100 px-2 py-0.5" title="The invitation email bounced — the address may be misspelled or not exist">Email not delivered</span>
        {fixed === intern.intern_id ? (
          <span className="text-emerald-600">Sent to the new address!</span>
        ) : (
          <button type="button" onClick={() => setFixingIntern(intern)} className="font-semibold text-blue-600 hover:underline">
            Fix email
          </button>
        )}
      </p>
    );
  }

  async function handleDelete(intern) {
    if (!window.confirm(`Delete ${intern.intern_name}? This can't be undone.`)) return;
    setDeletingId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not delete intern.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleStatus(intern, nextStatus) {
    setDeletingId(intern.deployment_id);
    setError("");
    try {
      const res = await apiFetch(`/api/coordinator/interns/${intern.deployment_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update status.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function load() {
    setLoading(true);
    Promise.all([fetchCoordinatorData("interns"), fetchCoordinatorData("companies")])
      .then(([internsRes, companiesRes]) => {
        setInterns(internsRes.interns ?? []);
        setCompanies(companiesRes.companies ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Inactive interns move to the Archive screen instead of cluttering this
  // list — they're never lost, just out of the way until restored.
  const activeInterns = interns.filter((i) => i.status !== "inactive");
  const statuses = ["All", ...new Set(activeInterns.map((i) => i.status))];
  const companyOptions = ["All", ...new Set(activeInterns.map((i) => i.company_name).filter(Boolean))];
  const courseOptions = ["All", ...new Set(activeInterns.map((i) => i.course).filter(Boolean))];
  const filtered = activeInterns.filter((i) => {
    const matchesStatus = statusFilter === "All" || i.status === statusFilter;
    const matchesCompany = companyFilter === "All" || i.company_name === companyFilter;
    const matchesCourse = courseFilter === "All" || i.course === courseFilter;
    const matchesQuery =
      !query ||
      i.intern_name?.toLowerCase().includes(query.toLowerCase()) ||
      i.company_name?.toLowerCase().includes(query.toLowerCase());
    return matchesStatus && matchesCompany && matchesCourse && matchesQuery;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Interns</h2>
          <p className="mt-1 text-sm text-slate-600">Every intern deployed under your school — hours, tasks, and evaluation progress at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/coordinator/interns/archive" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            View Archive
          </Link>
          <Link href="/coordinator/interns/import" className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
            <Icon name="upload" size={15} /> Import from Excel
          </Link>
          <button onClick={() => setShowAdd(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Add intern
          </button>
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
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-blue-500"
          >
            {statuses.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
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
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading interns…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {interns.length === 0 ? "No interns have been deployed yet." : "No interns match this filter."}
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
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[i.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {i.status}
                      </span>
                      <InternRowMenu
                        intern={i}
                        onToggleStatus={handleToggleStatus}
                        onDelete={handleDelete}
                        busy={deletingId === i.deployment_id}
                      />
                    </div>
                  </div>

                  {i.account_status === "pending_activation" && i.email_bounced && bouncedNotice(i)}
                  {i.account_status === "pending_activation" && !i.email_bounced && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5">Invite pending</span>
                      {resent === i.intern_id ? (
                        <span className="text-emerald-600">Sent!</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleResend(i)}
                          disabled={resendingId === i.intern_id}
                          className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
                        >
                          {resendingId === i.intern_id ? "Resending…" : "Resend invite"}
                        </button>
                      )}
                    </p>
                  )}
                  {i.pending_attendance > 0 && (
                    <p className="mt-1 text-xs font-medium text-amber-600">{i.pending_attendance} attendance record{i.pending_attendance === 1 ? "" : "s"} pending review</p>
                  )}

                  <p className="mt-2 text-sm text-slate-700">
                    {i.company_name ?? "—"}
                    {i.supervisor_name && ` · Supervisor: ${i.supervisor_name}`}
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>{i.hours_completed}h</span>
                        <span>{i.required_hours}h</span>
                      </div>
                      <ProgressBar pct={i.hours_progress_pct} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>{i.tasks_completed}/{i.tasks_total}</span>
                        <span>{i.task_progress_pct}%</span>
                      </div>
                      <ProgressBar pct={i.task_progress_pct} tone="emerald" />
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-slate-500">
                    Latest evaluation: {i.latest_evaluation_score != null ? `${i.latest_evaluation_score}%` : "No evaluations yet"}
                  </p>
                  <Link href={`/coordinator/interns/${i.deployment_id}/portfolio`} className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline">
                    View portfolio →
                  </Link>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Intern</th>
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Hours</th>
                    <th className="px-5 py-3">Tasks</th>
                    <th className="px-5 py-3">Latest evaluation</th>
                    <th className="px-5 py-3">Status</th>
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
                        {i.account_status === "pending_activation" && i.email_bounced && bouncedNotice(i)}
                        {i.account_status === "pending_activation" && !i.email_bounced && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                            <span className="rounded-full bg-amber-100 px-2 py-0.5">Invite pending</span>
                            {resent === i.intern_id ? (
                              <span className="text-emerald-600">Sent!</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleResend(i)}
                                disabled={resendingId === i.intern_id}
                                className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
                              >
                                {resendingId === i.intern_id ? "Resending…" : "Resend invite"}
                              </button>
                            )}
                          </p>
                        )}
                        {i.pending_attendance > 0 && (
                          <p className="mt-1 text-xs font-medium text-amber-600">{i.pending_attendance} attendance record{i.pending_attendance === 1 ? "" : "s"} pending review</p>
                        )}
                        <Link href={`/coordinator/interns/${i.deployment_id}/portfolio`} className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline">
                          View portfolio →
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {i.company_name ?? "—"}
                        {i.supervisor_name && <p className="text-xs text-slate-400">Supervisor: {i.supervisor_name}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <div className="w-32">
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>{i.hours_completed}h</span>
                            <span>{i.required_hours}h</span>
                          </div>
                          <ProgressBar pct={i.hours_progress_pct} />
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="w-32">
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>{i.tasks_completed}/{i.tasks_total}</span>
                            <span>{i.task_progress_pct}%</span>
                          </div>
                          <ProgressBar pct={i.task_progress_pct} tone="emerald" />
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {i.latest_evaluation_score != null ? `${i.latest_evaluation_score}%` : <span className="text-slate-400">No evaluations yet</span>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[i.status] ?? "bg-slate-100 text-slate-700"}`}>
                          {i.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <InternRowMenu
                          intern={i}
                          onToggleStatus={handleToggleStatus}
                          onDelete={handleDelete}
                          busy={deletingId === i.deployment_id}
                        />
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

      {fixingIntern && (
        <FixEmailModal
          userId={fixingIntern.intern_id}
          name={fixingIntern.intern_name}
          currentEmail={fixingIntern.intern_email}
          onClose={() => setFixingIntern(null)}
          onFixed={() => { setFixed(fixingIntern.intern_id); setFixingIntern(null); load(); }}
        />
      )}
      {showAdd && (
        <AddInternModal companies={companies} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}
