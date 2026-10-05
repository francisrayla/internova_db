"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import { validateImageFile } from "@/lib/imageValidation";
import { inputProps } from "@/lib/inputRules";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

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
    <img src={template.logo_url} alt="School logo" className="h-16 w-auto max-w-[6rem] rounded-lg border border-slate-200 object-contain" />
  ) : (
    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">No logo</div>
  );

  const previewLink =
    previewId === undefined ? (
      <span className="text-sm text-slate-400">Checking interns…</span>
    ) : previewId ? (
      <Link href={`/coordinator/interns/${previewId}/narrative-report`} className="text-sm font-semibold text-blue-600 hover:underline">
        Preview with an intern →
      </Link>
    ) : (
      <span className="text-sm text-slate-400">Add an intern to preview the report.</span>
    );

  return (
    <div className="mt-8 max-w-lg rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Narrative Report</h2>
          <p className="mt-1 text-sm text-slate-600">The letterhead and cover printed on every intern&apos;s narrative report.</p>
        </div>
        {template && !editing && (
          <button type="button" onClick={startEdit} className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Edit
          </button>
        )}
      </div>

      {!template ? (
        <p className="mt-4 text-sm text-slate-400">{error || "Loading…"}</p>
      ) : !editing ? (
        <div className="mt-4 text-sm">
          {message && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}
          <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
            {logo}
            <div className="min-w-0">
              <p className="font-semibold uppercase text-slate-900">{template.letterhead.school_name || "—"}</p>
              {[template.letterhead.address, template.letterhead.contact, template.letterhead.website].filter(Boolean).map((line) => (
                <p key={line} className="text-xs text-slate-500">{line}</p>
              ))}
            </div>
          </div>
          {[
            ["Department", template.cover.department],
            ["Submitted to", [template.cover.submitted_to_name, template.cover.submitted_to_title].filter(Boolean).join(", ")],
            ["School year", template.cover.school_year || "From each intern's start date"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2.5">
              <span className="text-slate-500">{label}</span>
              <span className="text-right font-semibold text-slate-900">{value || "—"}</span>
            </div>
          ))}
          <div className="mt-4">{previewLink}</div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-4">
            {logo}
            <div className="space-y-1.5">
              <label className="inline-block cursor-pointer rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {uploading ? "Uploading…" : template.logo_url ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={uploading} className="hidden" />
              </label>
              {template.logo_url && (
                <button type="button" onClick={removeLogo} className="ml-2 text-sm font-semibold text-red-600 hover:underline">Remove</button>
              )}
              <p className="text-xs text-slate-400">JPG, PNG or WebP, up to 2 MB.</p>
            </div>
          </div>

          <form onSubmit={save} className="mt-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Letterhead</p>
            {LETTERHEAD_FIELDS.map(([key, label]) => (
              <label key={key} className="block text-sm">
                <span className="mb-1 block text-slate-600">{label}</span>
                <input {...inputProps("shortText")} value={form.letterhead[key] ?? ""} onChange={(e) => setField("letterhead", key, e.target.value)} className={inputClass} />
              </label>
            ))}
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Cover page</p>
            {COVER_FIELDS.map(([key, label]) => (
              <label key={key} className="block text-sm">
                <span className="mb-1 block text-slate-600">{label}</span>
                <input {...inputProps("shortText")} value={form.cover[key] ?? ""} onChange={(e) => setField("cover", key, e.target.value)} className={inputClass} />
              </label>
            ))}

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}

            <p className="text-xs text-slate-400">Blank fields use the defaults from your school record.</p>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={cancelEdit} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
