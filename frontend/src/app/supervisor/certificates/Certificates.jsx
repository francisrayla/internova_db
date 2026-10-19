"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { Upload } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Banner, SkeletonList } from "@/components/ui";
import { Btn, FormField, Input, Page, PageHeader, Section, Select } from "@/components/dash/page";
import { clean, inputProps } from "@/lib/inputRules";

/** Saves a file the server sent back (the filled-in PowerPoint, or the sample template). */
async function saveDownload(res, fallbackName) {
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

async function errorMessage(res, fallback) {
  const data = await res.json().catch(() => ({}));
  return data.message || fallback;
}

function StepHeading({ n, title, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ui-accent-soft)] text-sm font-semibold text-[var(--ui-accent)]">{n}</span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{text}</p>
      </div>
    </div>
  );
}

export default function Certificates() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [form, setForm] = useState({ deployment_id: "", name: "", uppercase: true, hours: "", start_date: "", end_date: "", date_issued: "", signatory: "" });
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef(null);

  function load() {
    return fetchSupervisorData("certificates")
      .then((d) => {
        setData(d);
        setForm((f) => ({ ...f, date_issued: f.date_issued || d.today, signatory: f.signatory || d.supervisor_name }));
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  function pickIntern(id) {
    const intern = data.interns.find((i) => String(i.deployment_id) === String(id));
    setForm((f) => ({
      ...f,
      deployment_id: id,
      name: intern?.name ?? "",
      hours: intern ? String(intern.hours) : "",
      start_date: intern?.start_date ?? "",
      end_date: intern?.end_date ?? "",
    }));
    setNotice("");
  }

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("template", file);
      const res = await apiFetch("/api/supervisor/certificates/template", { method: "POST", body });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not upload the template."));
      await load();
      setNotice("Template saved. Every supervisor of your company can use it now.");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeTemplate() {
    setRemoving(true);
    try {
      const res = await apiFetch("/api/supervisor/certificates/template", { method: "DELETE" });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not remove the template."));
      setConfirmRemove(false);
      await load();
      setNotice("Template removed.");
    } catch (err) {
      setError(err.message);
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  async function downloadSample() {
    setError("");
    try {
      const res = await apiFetch("/api/supervisor/certificates/sample");
      if (!res.ok) throw new Error("Could not download the sample.");
      await saveDownload(res, "Sample certificate template.pptx");
    } catch (err) {
      setError(err.message);
    }
  }

  async function generate(e) {
    e.preventDefault();
    if (!form.deployment_id) {
      setError("Choose the intern first.");
      return;
    }
    if (!form.name.trim()) {
      setError("Type the name that should appear on the certificate.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const payload = { ...form, hours: form.hours === "" ? null : Number(form.hours) };
      Object.keys(payload).forEach((k) => payload[k] === "" && delete payload[k]);
      const res = await apiFetch("/api/supervisor/certificates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not make the certificate."));
      const file = await saveDownload(res, "Certificate of Completion.pptx");
      setNotice(`Done. ${file} was downloaded. Open it in PowerPoint to print or adjust.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  const template = data?.template;
  const selected = data?.interns.find((i) => String(i.deployment_id) === String(form.deployment_id));
  // The most hours a certificate may state: what was rendered, or the required hours for an intern marked completed.
  const maxHours = selected ? Math.max(Number(selected.hours) || 0, Number(selected.required_hours) || 0) : 0;
  const tooManyHours = selected && form.hours !== "" && Number(form.hours) > maxHours + 0.05;
  const unfinished = (data?.interns ?? []).filter((i) => i.finished === false);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Certificates"
        sentence="Upload your OJT certificate once as a PowerPoint. Then type or confirm an intern's name and get a finished certificate to print."
      />

      {error && <Banner tone="red">{error}</Banner>}
      {notice && <Banner tone="green">{notice}</Banner>}

      {loading ? (
        <SkeletonList rows={2} height="h-40" />
      ) : !data ? null : (
        <>
          <Section>
            <div className="space-y-4">
              <StepHeading n="1" title="Your certificate template" text="A PowerPoint file (.pptx) of your certificate. Shared with every supervisor of your company." />

              {template ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ui-ok-bg)] px-4 py-3 text-sm text-[var(--ui-ok)]">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{template.name}</p>
                    <p className="text-xs">
                      Saved {template.uploaded_at}
                      {template.uploaded_by ? ` by ${template.uploaded_by}` : ""} · uses {template.markers.length} marker{template.markers.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex gap-2 max-sm:w-full">
                    <Btn sm onClick={() => fileRef.current?.click()} disabled={uploading} className="max-sm:flex-1">
                      {uploading ? "Uploading…" : "Replace"}
                    </Btn>
                    <Btn sm variant="danger-quiet" onClick={() => setConfirmRemove(true)} className="max-sm:flex-1">
                      Remove
                    </Btn>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-[var(--ui-border)] px-4 py-8 text-center hover:bg-[var(--ui-soft)] disabled:opacity-60 max-sm:min-h-[44px]"
                >
                  <Upload size={20} aria-hidden="true" className="text-slate-500" />
                  <span className="text-sm font-semibold text-slate-900">{uploading ? "Uploading…" : "Choose your PowerPoint template"}</span>
                  <span className="text-xs text-slate-500">.pptx, up to 10 MB</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />

              <details className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold text-slate-900 max-sm:flex max-sm:min-h-[44px] max-sm:items-center">How to prepare the template</summary>
                <p className="mt-3">
                  Design the certificate in PowerPoint. Where something changes for each intern, type a marker such as <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-blue-700">{"{{NAME}}"}</code>.
                  It is replaced with the real text and keeps the font, size and colour you gave it. <strong>{"{{NAME}}"}</strong> is required.
                </p>
                <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {data.placeholders.map((p) => (
                    <li key={p.key} className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
                      <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-blue-700">{p.token}</code>
                      <span className="min-w-0 text-slate-600">{p.description}</span>
                    </li>
                  ))}
                </ul>
                <Btn sm onClick={downloadSample} className="mt-4 max-sm:w-full">
                  Download a sample template
                </Btn>
              </details>
            </div>
          </Section>

          <Section className={template ? "" : "opacity-70"}>
            <div className="space-y-4">
              <StepHeading n="2" title="Make a certificate" text="Choose the intern and check the name. The PowerPoint downloads right away." />

              {!template && <p className="k-note is-warn">Upload a template in step 1 first.</p>}

              <form onSubmit={generate} className="space-y-4">
                <fieldset disabled={!template || generating} className="space-y-4 disabled:pointer-events-none">
                  <FormField label="Intern">
                    <Select value={form.deployment_id} onChange={(e) => pickIntern(e.target.value)}>
                      <option value="">Choose an intern…</option>
                      {data.interns.map((i) => (
                        <option key={i.deployment_id} value={i.deployment_id} disabled={i.finished === false}>
                          {i.name} · {i.hours}/{i.required_hours} hours{i.status === "completed" ? " · completed" : i.finished === false ? " · not finished" : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  {unfinished.length > 0 && (
                    <p className="k-hint">
                      A certificate can be made once an intern has finished the required hours. Not finished yet: {unfinished.map((i) => `${i.name} (${i.hours} of ${i.required_hours} h)`).join(", ")}.
                    </p>
                  )}

                  <FormField label="Name on the certificate" hint="Edit it if you want it written differently, for example with a middle initial.">
                    <Input value={form.name} {...inputProps("signName")} onChange={(e) => setForm((f) => ({ ...f, name: clean("signName", e.target.value) }))} placeholder="Full name" />
                  </FormField>

                  <label className="k-check">
                    <input type="checkbox" checked={form.uppercase} onChange={(e) => setForm((f) => ({ ...f, uppercase: e.target.checked }))} className="accent-blue-600" />
                    Print the name in CAPITAL LETTERS
                  </label>

                  <details className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-slate-900 max-sm:flex max-sm:min-h-[44px] max-sm:items-center">Other details (already filled in)</summary>
                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FormField label="Hours rendered" error={tooManyHours ? `At most ${maxHours} hours, the hours on record.` : undefined} hint={selected && !tooManyHours ? `Up to ${maxHours} hours.` : undefined}>
                        <Input type="number" min="0" max={selected ? maxHours : undefined} step="0.1" value={form.hours} aria-invalid={tooManyHours || undefined} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} />
                      </FormField>
                      <FormField label="Signed by">
                        <Input value={form.signatory} {...inputProps("signName")} onChange={(e) => setForm((f) => ({ ...f, signatory: clean("signName", e.target.value) }))} />
                      </FormField>
                      <FormField label="Training started">
                        <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                      </FormField>
                      <FormField label="Training ended">
                        <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                      </FormField>
                      <FormField label="Date given">
                        <Input type="date" value={form.date_issued} onChange={(e) => setForm((f) => ({ ...f, date_issued: e.target.value }))} />
                      </FormField>
                    </div>
                  </details>
                </fieldset>

                <div className="flex justify-end">
                  <Btn variant="primary" type="submit" disabled={!template || generating || tooManyHours} className="max-sm:w-full">
                    {generating ? "Making it…" : "Generate PowerPoint"}
                  </Btn>
                </div>
              </form>
            </div>
          </Section>
        </>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the certificate template?"
        confirmLabel="Remove template"
        busy={removing}
        onConfirm={removeTemplate}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>Certificates you already downloaded are not affected. You can upload a template again any time.</p>
      </ConfirmDialog>
    </Page>
  );
}
