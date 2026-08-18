"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const LIVE_TYPES = ["document_reviewed", "document_uploaded"];

export default function MyDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [docType, setDocType] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchInternData("documents")
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(LIVE_TYPES, load);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!docType.trim()) {
      setError("Give this document a type/name, e.g. Resume.");
      return;
    }
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("document_type", docType.trim());
      formData.append("file", file);
      const res = await apiFetch("/api/intern/documents", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not upload this document.");
      setDocType("");
      setFile(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Documents</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Your files on record</h1>
          <p className="mt-1 text-sm text-slate-600">Requirements uploaded by your coordinator, plus anything you add yourself.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ Upload document"}
        </button>
      </section>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Document type</span>
            <input
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="e.g. Resume, Endorsement Letter, MOA"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">File</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700"
            />
            <span className="mt-1 block text-xs text-slate-400">JPG, PNG, PDF, DOC or DOCX, up to 5MB.</span>
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">All documents</h2>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Nothing on file yet.</p>
        ) : (
          <ul className="space-y-3">
            {documents.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                    <Icon name="file" size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{d.document_type}</p>
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-blue-600 hover:underline">
                      {d.file_name}
                    </a>
                    <p className="mt-0.5 text-xs text-slate-400">{d.uploaded_at}</p>
                    {d.remarks && <p className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{d.remarks}</p>}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
