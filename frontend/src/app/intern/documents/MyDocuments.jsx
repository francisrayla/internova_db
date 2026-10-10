"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { Plus } from "lucide-react";
import { Btn, DataList, DataRow, EmptyState, FormField, Page, PageHeader, Pill, Section, SkeletonList } from "@/components/dash/page";
import FileLink from "@/components/FileViewer";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { shrinkImage } from "@/lib/imageCompress";

import DocumentTypeField from "@/components/DocumentTypeField";
const STATUS_TONES = { pending: "amber", approved: "green", rejected: "red" };
const REQUIREMENT_TONES = { not_uploaded: "slate", ...STATUS_TONES };
const REQUIREMENT_LABELS = { not_uploaded: "Not uploaded", pending: "Pending review", approved: "Approved", rejected: "Rejected" };

const LIVE_TYPES = ["document_reviewed", "document_uploaded"];
// Same ceiling as the server (10MB): saying so here beats the server's vague "The file failed to upload."
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export default function MyDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [docType, setDocType] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  // What the intern's course requires (with each one's status) and the other types an upload may use.
  const [types, setTypes] = useState(null);
  const [formKey, setFormKey] = useState(0); // remounts the type field when a requirement row presets it

  const load = useCallback(() => {
    fetchInternData("documents")
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
    fetchInternData("document-types")
      .then((data) => setTypes(data))
      .catch(() => setTypes(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(LIVE_TYPES, load);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // a double tap lands before the button is disabled
    if (!docType.trim()) {
      setError("Choose a document type.");
      return;
    }
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const upload = await shrinkImage(file);
      if (upload.size > MAX_DOCUMENT_BYTES) {
        throw new Error(`"${upload.name}" is bigger than 10MB. Choose a smaller file.`);
      }
      const formData = new FormData();
      formData.append("document_type", docType.trim());
      formData.append("file", upload);
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
      submittingRef.current = false;
      setSaving(false);
    }
  }

  function uploadRequirement(type) {
    setDocType(type);
    setFormKey((k) => k + 1);
    setError("");
    setShowForm(true);
  }

  const requirements = types?.requirements ?? [];
  const options = types ? { required: requirements.map((r) => r.document_type), others: types.others ?? [] } : undefined;
  const doneCount = requirements.filter((r) => r.status === "approved").length;

  return (
    <Page size="narrow">
      <PageHeader title="Your files on record" sentence="Requirements uploaded by your coordinator, plus anything you add yourself.">
        <Btn variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : <><Plus size={16} aria-hidden="true" /> Upload document</>}
        </Btn>
      </PageHeader>

      {showForm && (
        <Section title="Upload a document">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <FormField label="Document type">
              <DocumentTypeField key={formKey} value={docType} onChange={setDocType} options={options} />
            </FormField>
            <FormField label="File" hint="JPG, PNG, PDF, DOC or DOCX, up to 10MB. Photos are resized automatically.">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="k-input"
              />
            </FormField>
            {error && <p role="alert" className="k-note is-risk">{error}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="k-btn is-primary max-sm:w-full">
                {saving ? "Uploading…" : "Upload"}
              </button>
            </div>
          </form>
        </Section>
      )}

      {requirements.length > 0 && (
        <Section
          flush
          title={`Required for your course${types?.course ? ` (${types.course})` : ""}`}
          help={`${doneCount} of ${requirements.length} approved`}
        >
          <DataList>
            {requirements.map((r) => (
              <DataRow
                key={r.document_type}
                wrap
                title={r.document_type}
                side={<Pill tone={REQUIREMENT_TONES[r.status] ?? "slate"}>{REQUIREMENT_LABELS[r.status] ?? r.status}</Pill>}
                actions={
                  (r.status === "not_uploaded" || r.status === "rejected") ? (
                    <Btn sm onClick={() => uploadRequirement(r.document_type)}>
                      {r.status === "rejected" ? "Upload again" : "Upload"}
                    </Btn>
                  ) : undefined
                }
              />
            ))}
          </DataList>
        </Section>
      )}

      <Section flush title="All documents">
        {loading ? (
          <div className="k-pad"><SkeletonList rows={2} height="h-20" /></div>
        ) : documents.length === 0 ? (
          <div className="k-pad"><EmptyState icon="documents" title="Nothing on file yet" text="Upload a requirement or any document you want your coordinator to see." /></div>
        ) : (
          <ul className="k-list">
            {documents.map((d) => (
              <li key={d.id} className="k-item flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-slate-500"><NavIcon name="file" size={18} /></span>
                  <div className="min-w-0">
                    <p className="break-words text-[0.9375rem] font-semibold text-slate-900">{d.document_type}</p>
                    <FileLink url={d.file_url} name={d.file_name} subtitle={d.document_type} className="block max-w-full truncate py-1 text-left text-sm text-blue-600 hover:underline max-sm:min-h-[44px]">
                      {d.file_name}
                    </FileLink>
                    <p className="text-sm text-slate-500">{d.uploaded_at}</p>
                    {d.remarks && <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{d.remarks}</p>}
                  </div>
                </div>
                <Pill tone={STATUS_TONES[d.status] ?? "slate"} className="shrink-0 capitalize">{d.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
