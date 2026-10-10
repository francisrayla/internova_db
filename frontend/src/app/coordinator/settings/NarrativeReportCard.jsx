"use client";

import { useEffect, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { validateImageFile } from "@/lib/imageValidation";
import { inputProps } from "@/lib/inputRules";
import { Btn, FormField, Input, KeyValueList, Page, PageHeader, Section, btnClass } from "@/components/dash/page";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const LETTERHEAD_FIELDS = [
  ["school_name", "School name (printed in caps)"],
  ["address", "Address line"],
  ["contact", "Contact line, e.g. Tel. No.: (043) 123-4567"],
  ["website", "Website line, e.g. Website: www.school.edu.ph"],
];
const COVER_FIELDS = [
  ["department", "Department, e.g. School of Criminology"],
  ["program_text", "Program line"],
  ["submitted_to_name", "Submitted to (coordinator name)"],
  ["submitted_to_title", "Submitted to (title)"],
  ["school_year", "School year, e.g. 2026-2027 (blank = from start date)"],
];

export default function NarrativeReportCard() {
  const [template, setTemplate] = useState(null);
  const [form, setForm] = useState({ letterhead: {}, cover: {} });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState(undefined); // undefined = loading, null = no interns

  function applyTemplate(t) {
    setTemplate(t);
    setForm({ letterhead: { ...t.letterhead }, cover: { ...t.cover } });
  }

  useEffect(() => {
    fetchCoordinatorData("narrative-template")
      .then((d) => applyTemplate(d.template))
      .catch(() => setError("Could not load the narrative report settings."));
    fetchCoordinatorData("interns")
      .then((d) => setPreviewId(d.interns?.[0]?.deployment_id ?? null))
      .catch(() => setPreviewId(null));
  }, []);

  function setField(group, key, value) {
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: value } }));
  }

  function startEdit() {
    setMessage("");
    setError("");
    setEditing(true);
  }

  function cancelEdit() {
    applyTemplate(template);
    setError("");
    setEditing(false);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/coordinator/narrative-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save.");
      applyTemplate(data.template);
      setEditing(false);
      setMessage("Narrative report settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const invalid = validateImageFile(file, MAX_LOGO_BYTES);
    if (invalid) {
      setError(invalid);
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("logo", file);
      const res = await apiFetch("/api/coordinator/narrative-template/logo", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not upload the logo.");
      setTemplate(data.template);
      setMessage("Logo updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    setError("");
    setMessage("");
    const res = await apiFetch("/api/coordinator/narrative-template/logo", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      setTemplate(data.template);
      setMessage("Logo removed.");
    } else {
      setError(data.message || "Could not remove the logo.");
    }
  }

  const logo = template?.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={template.logo_url} alt="School logo" className="h-16 w-auto max-w-[6rem] shrink-0 rounded-lg border border-slate-200 object-contain" />
  ) : (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-600">No logo</div>
  );

  const previewLink =
    previewId === undefined ? (
      <span className="text-sm text-slate-600">Checking interns…</span>
    ) : previewId ? (
      <Btn sm href={`/coordinator/interns/${previewId}/narrative-report`}>Preview with an intern</Btn>
    ) : (
      <span className="text-sm text-slate-600">Add an intern to preview the report.</span>
    );

  return (
    <Page size="narrow">
      <PageHeader title="Narrative Report" sentence="The letterhead and cover printed on every intern's narrative report.">
        {template && !editing && <Btn onClick={startEdit}>Edit</Btn>}
      </PageHeader>

      <Section>
        {!template ? (
          <p className="text-sm text-slate-600">{error || "Loading…"}</p>
        ) : !editing ? (
          <div className="space-y-4">
            {message && <p className="k-note is-ok">{message}</p>}
            <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
              {logo}
              <div className="min-w-0">
                <p className="break-words font-semibold uppercase text-slate-900">{template.letterhead.school_name || "—"}</p>
                {[template.letterhead.address, template.letterhead.contact, template.letterhead.website].filter(Boolean).map((line) => (
                  <p key={line} className="break-words text-xs text-slate-600">{line}</p>
                ))}
              </div>
            </div>
            <KeyValueList
              items={[
                { label: "Department", value: template.cover.department || "—" },
                { label: "Submitted to", value: [template.cover.submitted_to_name, template.cover.submitted_to_title].filter(Boolean).join(", ") || "—" },
                { label: "School year", value: template.cover.school_year || "From each intern's start date" },
              ]}
            />
            <div>{previewLink}</div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              {logo}
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className={btnClass("secondary", { sm: true, className: "cursor-pointer" })}>
                    {uploading ? "Uploading…" : template.logo_url ? "Replace logo" : "Upload logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={uploading} className="hidden" />
                  </label>
                  {template.logo_url && (
                    <Btn sm variant="danger-quiet" onClick={removeLogo}>Remove</Btn>
                  )}
                </div>
                <p className="k-hint">JPG, PNG or WebP, up to 2 MB.</p>
              </div>
            </div>

            <form onSubmit={save} className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Letterhead</p>
              {LETTERHEAD_FIELDS.map(([key, label]) => (
                <FormField key={key} label={label}>
                  <Input {...inputProps("shortText")} value={form.letterhead[key] ?? ""} onChange={(e) => setField("letterhead", key, e.target.value)} />
                </FormField>
              ))}
              <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Cover page</p>
              {COVER_FIELDS.map(([key, label]) => (
                <FormField key={key} label={label}>
                  <Input {...inputProps("shortText")} value={form.cover[key] ?? ""} onChange={(e) => setField("cover", key, e.target.value)} />
                </FormField>
              ))}

              {error && <p className="k-note is-risk" role="alert">{error}</p>}
              {message && <p className="k-note is-ok">{message}</p>}

              <p className="k-hint">Blank fields use the defaults from your school record.</p>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Btn onClick={cancelEdit}>Cancel</Btn>
                <Btn variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
              </div>
            </form>
          </div>
        )}
      </Section>
    </Page>
  );
}
