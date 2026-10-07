"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500";

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

function Field({ label, hint, children }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1.5 block font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function StepHeading({ n, title, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-semibold text-white">{n}</span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
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
  const short = selected && selected.required_hours > 0 && selected.hours < selected.required_hours;

  return (
    <div className="relative mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Certificates</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload your OJT certificate once as a PowerPoint. Then type or confirm an intern&apos;s name and get a finished certificate to print.
        </p>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p>}

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : !data ? null : (
        <>
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <StepHeading n="1" title="Your certificate template" text="A PowerPoint file (.pptx) of your certificate. Shared with every supervisor of your company." />

            {template ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
                  <p className="text-xs text-slate-600">
                    Saved {template.uploaded_at}
                    {template.uploaded_by ? ` by ${template.uploaded_by}` : ""} · uses {template.markers.length} marker{template.markers.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {uploading ? "Uploading…" : "Replace"}
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(true)} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-blue-400 hover:bg-blue-50 disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-slate-900">{uploading ? "Uploading…" : "Choose your PowerPoint template"}</span>
                <span className="text-xs text-slate-500">.pptx, up to 10 MB</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />

            <details className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold text-slate-900">How to prepare the template</summary>
              <p className="mt-3">
                Design the certificate in PowerPoint. Where something changes for each intern, type a marker such as <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-blue-700">{"{{NAME}}"}</code>.
                It is replaced with the real text and keeps the font, size and colour you gave it. <strong>{"{{NAME}}"}</strong> is required.
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {data.placeholders.map((p) => (
                  <li key={p.key} className="flex min-w-0 gap-2">
                    <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-blue-700">{p.token}</code>
                    <span className="min-w-0 text-slate-600">{p.description}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={downloadSample} className="mt-4 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Download a sample template
              </button>
            </details>
          </section>

          <section className={`space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${template ? "" : "opacity-60"}`}>
            <StepHeading n="2" title="Make a certificate" text="Choose the intern and check the name. The PowerPoint downloads right away." />

            {!template && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Upload a template in step 1 first.</p>}

            <form onSubmit={generate} className="space-y-4">
              <fieldset disabled={!template || generating} className="space-y-4 disabled:pointer-events-none">
                <Field label="Intern">
                  <select value={form.deployment_id} onChange={(e) => pickIntern(e.target.value)} className={inputClass}>
                    <option value="">Choose an intern…</option>
                    {data.interns.map((i) => (
                      <option key={i.deployment_id} value={i.deployment_id}>
                        {i.name} · {i.hours}/{i.required_hours} hours{i.status === "completed" ? " · completed" : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                {short && (
                  <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {selected.name} has {selected.hours} of {selected.required_hours} required hours. You can still make the certificate.
                  </p>
                )}

                <Field label="Name on the certificate" hint="Edit it if you want it written differently, for example with a middle initial.">
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} placeholder="Full name" className={inputClass} />
                </Field>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.uppercase} onChange={(e) => setForm((f) => ({ ...f, uppercase: e.target.checked }))} className="h-4 w-4 accent-blue-600" />
                  Print the name in CAPITAL LETTERS
                </label>

                <details className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-slate-900">Other details (already filled in)</summary>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Hours rendered">
                      <input type="number" min="0" step="0.1" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Signed by">
                      <input value={form.signatory} onChange={(e) => setForm((f) => ({ ...f, signatory: e.target.value }))} maxLength={120} className={inputClass} />
                    </Field>
                    <Field label="Training started">
                      <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Training ended">
                      <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Date given">
                      <input type="date" value={form.date_issued} onChange={(e) => setForm((f) => ({ ...f, date_issued: e.target.value }))} className={inputClass} />
                    </Field>
                  </div>
                </details>
              </fieldset>

              <div className="flex justify-end">
                <button type="submit" disabled={!template || generating} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {generating ? "Making it…" : "Generate PowerPoint"}
                </button>
              </div>
            </form>
          </section>
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
    </div>
  );
}
