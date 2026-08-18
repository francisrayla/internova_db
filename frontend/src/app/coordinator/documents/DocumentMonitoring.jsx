"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

const DOCUMENT_TYPES = ["Endorsement Letter", "Memorandum of Agreement", "Medical Certificate", "Insurance", "Waiver", "Other"];

function UploadModal({ interns, onClose, onSaved }) {
  const [form, setForm] = useState({ deployment_id: interns[0]?.deployment_id ?? "", document_type: DOCUMENT_TYPES[0] });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deployment_id || !file) {
      setError("Select an intern and choose a file.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      body.append("deployment_id", form.deployment_id);
      body.append("document_type", form.document_type);
      body.append("file", file);
      const res = await apiFetch("/api/coordinator/documents", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not upload document.");
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
        <h3 className="text-lg font-semibold text-slate-900">Upload a document</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Intern</span>
            <select value={form.deployment_id} onChange={(e) => setForm((f) => ({ ...f, deployment_id: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Document type</span>
            <select value={form.document_type} onChange={(e) => setForm((f) => ({ ...f, document_type: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">File</span>
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Uploading…" : "Upload"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DocumentMonitoring() {
  const [documents, setDocuments] = useState([]);
  const [interns, setInterns] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : "";
    fetchCoordinatorData(`documents${params}`)
      .then((r) => {
        setDocuments(r.documents ?? []);
        setInterns(r.interns ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function review(id, status) {
    const remarks = status === "rejected" ? window.prompt("Reason for rejecting this document (optional):") ?? "" : "";
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/coordinator/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, remarks }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
          <p className="mt-1 text-sm text-slate-600">Compliance paperwork for each internship — upload, then review for approval.</p>
        </div>
        <button onClick={() => setShowModal(true)} disabled={interns.length === 0} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          Upload document
        </button>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading documents…</p>
        ) : documents.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No documents uploaded yet.</p>
        ) : (
          documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{d.document_type}</p>
                <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">{d.file_name}</a>
                <p className="mt-1 text-xs text-slate-400">{d.intern_name} · Uploaded {d.uploaded_at}</p>
                {d.remarks && <p className="mt-1 text-xs text-slate-500">Remarks: {d.remarks}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                {d.status === "pending" && (
                  <>
                    <button onClick={() => review(d.id, "approved")} disabled={busyId === d.id} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Approve</button>
                    <button onClick={() => review(d.id, "rejected")} disabled={busyId === d.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {showModal && (
        <UploadModal interns={interns} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}
