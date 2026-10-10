"use client";

import { useEffect, useRef, useState } from "react";
import FileLink from "@/components/FileViewer";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { shrinkImage } from "@/lib/imageCompress";
import DocumentTypeField from "@/components/DocumentTypeField";
import { EmptyState, ErrorNote, Pill, SkeletonList } from "@/components/ui";
import { Btn, DataList, DataRow, FilterBar, FormField, Input, Page, PageHeader, Section, Select, SheetFrame, Textarea } from "@/components/dash/page";
import NavIcon from "@/components/NavIcon";
import Pagination from "@/components/Pagination";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const STATUS_TONES = { approved: "green", pending: "amber", rejected: "red" };

function UploadModal({ interns, onClose, onSaved }) {
  const [form, setForm] = useState({ deployment_id: interns[0]?.deployment_id ?? "", document_type: "" });
  // The chosen intern's course requirements first, then the other types (null until loaded: built-in list).
  const [types, setTypes] = useState(null);
  const [typesKey, setTypesKey] = useState(0);

  useEffect(() => {
    if (!form.deployment_id) return;
    let live = true;
    fetchCoordinatorData(`document-types?deployment_id=${form.deployment_id}`)
      .then((d) => {
        if (!live) return;
        setTypes({ required: (d.requirements ?? []).map((r) => r.document_type), others: d.others ?? [] });
        setTypesKey((k) => k + 1);
        setForm((f) => ({ ...f, document_type: d.requirements?.[0]?.document_type ?? "" }));
      })
      .catch(() => live && setTypes(null));
    return () => {
      live = false;
    };
  }, [form.deployment_id]);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deployment_id || !file) {
      setError("Select an intern and choose a file.");
      return;
    }
    if (!form.document_type.trim()) {
      setError("Choose or type a document type.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      body.append("deployment_id", form.deployment_id);
      body.append("document_type", form.document_type);
      body.append("file", await shrinkImage(file));
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
    <SheetFrame
      onClose={onClose}
      title="Upload a document"
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Intern">
          <Select value={form.deployment_id} onChange={(e) => setForm((f) => ({ ...f, deployment_id: e.target.value }))}>
            {interns.map((i) => <option key={i.deployment_id} value={i.deployment_id}>{i.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Document type">
          <DocumentTypeField key={typesKey} options={types ?? undefined} value={form.document_type} onChange={(v) => setForm((f) => ({ ...f, document_type: v }))} />
        </FormField>
        <FormField label="File">
          <Input type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
  );
}

// Reason for rejecting a document (optional). Cancel does nothing; "Reject document" sends the same PATCH as before.
function RejectSheet({ doc, busy, onCancel, onReject }) {
  const [reason, setReason] = useState("");
  return (
    <SheetFrame
      title="Reject this document?"
      description={`${doc.document_type} · ${doc.intern_name}`}
      onClose={busy ? undefined : onCancel}
      onSubmit={(e) => {
        e.preventDefault();
        onReject(reason.trim());
      }}
      footer={
        <>
          <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn variant="danger" type="submit" disabled={busy}>{busy ? "Rejecting…" : "Reject document"}</Btn>
        </>
      }
    >
      <FormField label="Reason (optional)" hint="The intern sees this so they know what to fix.">
        <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </FormField>
    </SheetFrame>
  );
}

export default function DocumentMonitoring() {
  const [documents, setDocuments] = useState([]);
  const [interns, setInterns] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null); // document waiting for a rejection reason
  const [approving, setApproving] = useState(null); // document waiting for approval confirmation
  const requestRef = useRef(0);

  // The server pages the list; the filter is applied to the whole set before paging.
  function load(nextPage = page) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (statusFilter) params.set("status", statusFilter);
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchCoordinatorData(`documents?${params}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        // A page that no longer exists (the last row was reviewed away) falls back to the last one.
        if (nextPage > 1 && (r.documents ?? []).length === 0 && (r.last_page ?? 1) < nextPage) {
          setPage(r.last_page ?? 1);
          return;
        }
        setDocuments(r.documents ?? []);
        setInterns(r.interns ?? []);
        setMeta({ total: r.total ?? 0, last_page: r.last_page ?? 1 });
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        setError(e.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    load(page);
  }, [statusFilter, page]);

  function changeFilter(value) {
    setLoading(true);
    setStatusFilter(value);
    setPage(1);
  }

  function goToPage(next) {
    setLoading(true);
    setPage(next);
  }

  async function review(id, status, remarks = "") {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/coordinator/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, remarks }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      setRejecting(null);
      setApproving(null);
      load();
    } catch (err) {
      setError(err.message);
      setRejecting(null);
      setApproving(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader title="Documents" sentence="Compliance paperwork for each internship — upload, then review for approval.">
        <Btn variant="primary" onClick={() => setShowModal(true)} disabled={interns.length === 0}>
          <NavIcon name="documents" size={15} /> Upload document
        </Btn>
      </PageHeader>

      <FilterBar>
        <Select value={statusFilter} onChange={(e) => changeFilter(e.target.value)} aria-label="Filter by status" className="sm:w-auto">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
      </FilterBar>

      {error && <ErrorNote onRetry={() => load()}>{error}</ErrorNote>}

      <Section flush>
        {loading && documents.length === 0 ? (
          <div className="k-pad"><SkeletonList rows={3} height="h-16" /></div>
        ) : documents.length === 0 ? (
          <div className="k-pad">
            <EmptyState icon="documents" title="No documents uploaded yet." text="Upload a document for an intern, or wait for interns to upload their own." />
          </div>
        ) : (
          <DataList>
            {documents.map((d) => (
              <DataRow
                key={d.id}
                wrap
                title={d.document_type}
                sub={
                  <>
                    <FileLink url={d.file_url} name={d.file_name} subtitle={`${d.document_type} · ${d.intern_name}`} className="block max-w-full truncate text-left text-xs font-medium text-blue-600 hover:underline max-sm:min-h-[44px] max-sm:py-2">{d.file_name}</FileLink>
                    <span className="block">{d.intern_name} · Uploaded {d.uploaded_at}</span>
                    {d.remarks && <span className="block">Remarks: {d.remarks}</span>}
                  </>
                }
                side={<Pill tone={STATUS_TONES[d.status] ?? "slate"} className="capitalize">{d.status}</Pill>}
                actions={
                  d.status === "pending" && (
                    <>
                      <Btn sm onClick={() => setApproving(d)} disabled={busyId === d.id}>Approve</Btn>
                      <Btn sm variant="danger-quiet" onClick={() => setRejecting(d)} disabled={busyId === d.id}>Reject</Btn>
                    </>
                  )
                }
              />
            ))}
          </DataList>
        )}
        <Pagination page={page} totalPages={meta.last_page} total={meta.total} loading={loading} onPageChange={goToPage} />
      </Section>

      {rejecting && (
        <RejectSheet doc={rejecting} busy={busyId === rejecting.id} onCancel={() => setRejecting(null)} onReject={(reason) => review(rejecting.id, "rejected", reason)} />
      )}
      <ConfirmDialog
        open={!!approving}
        tone="primary"
        title="Approve this document?"
        confirmLabel="Approve"
        busy={!!approving && busyId === approving.id}
        onConfirm={() => review(approving.id, "approved")}
        onCancel={() => setApproving(null)}
      >
        <p>{approving?.document_type} from {approving?.intern_name} will be marked as approved.</p>
      </ConfirmDialog>

      {showModal && (
        <UploadModal interns={interns} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </Page>
  );
}
