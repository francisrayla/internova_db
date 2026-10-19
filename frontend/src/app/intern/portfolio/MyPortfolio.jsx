"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Btn, EmptyState, FormField, Input, Page, PageHeader, Section, SkeletonList, Textarea } from "@/components/dash/page";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";
import UploadRequirementSheet from "@/components/narrative-report/UploadRequirementSheet";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { validateImageFile } from "@/lib/imageValidation";
import { shrinkImage } from "@/lib/imageCompress";

import { clean, inputProps } from "@/lib/inputRules";
const MAX_ITEM_IMAGE_BYTES = 10 * 1024 * 1024;

export default function MyPortfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ title: "", bio: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  const [showItemForm, setShowItemForm] = useState(false);
  const [itemForm, setItemForm] = useState({ title: "", description: "", project_url: "" });
  const [itemImage, setItemImage] = useState(null);
  const [savingItem, setSavingItem] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [deleting, setDeleting] = useState(null); // work sample waiting for "yes, remove it"
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Narrative report: texts the intern writes + what the report still lacks.
  const [texts, setTexts] = useState({ acknowledgement: "", personal_observation: "", suggestion: "" });
  const [savingTexts, setSavingTexts] = useState(false);
  const [textsMsg, setTextsMsg] = useState("");
  const [polishing, setPolishing] = useState("");
  const [narrative, setNarrative] = useState(null);
  const [uploadType, setUploadType] = useState(""); // report requirement being uploaded from the checklist

  const loadNarrative = useCallback(() => {
    fetchInternData("portfolio/narrative-report")
      .then(setNarrative)
      .catch(() => setNarrative(null));
  }, []);

  const load = useCallback(() => {
    fetchInternData("portfolio")
      .then((data) => {
        setPortfolio(data.portfolio);
        setDetails({ title: data.portfolio?.title ?? "", bio: data.portfolio?.bio ?? "" });
        const saved = data.portfolio?.report_texts ?? {};
        setTexts({ acknowledgement: saved.acknowledgement ?? "", personal_observation: saved.personal_observation ?? "", suggestion: saved.suggestion ?? "" });
      })
      .catch(() => setPortfolio(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    loadNarrative();
  }, [load, loadNarrative]);

  // Each checklist row says where to finish it: upload a document here, jump to the text box,
  // open the work-samples form, or go to the page that fills it (attendance, tasks, activities).
  function focusField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }

  function openAddItem() {
    setShowItemForm(true);
    setTimeout(() => focusField("portfolio-item-title"), 50);
  }

  function checklistAction(section, status) {
    const byHand = (href, label) => <Btn sm href={href}>{label}</Btn>;
    switch (section.source) {
      case "document": {
        if (status.done && !status.rejected) return null;
        const type = section.document_type || section.title.charAt(0) + section.title.slice(1).toLowerCase();
        return (
          <Btn sm variant="primary" onClick={() => setUploadType(type)}>
            <Upload size={14} aria-hidden="true" /> {status.rejected ? "Upload again" : "Upload"}
          </Btn>
        );
      }
      case "intern_text":
        return status.done ? null : <Btn sm onClick={() => focusField(`report-${section.key}`)}><Pencil size={14} aria-hidden="true" /> Write</Btn>;
      case "auto_ledger":
        return status.done ? null : byHand("/intern/attendance", "Clock in");
      case "auto_photos":
        return status.done ? null : byHand("/intern/tasks", "Add task proof");
      case "auto_work_samples":
        return status.done ? null : <Btn sm onClick={openAddItem}><Plus size={14} aria-hidden="true" /> Add item</Btn>;
      case "auto_journal":
        return status.done ? null : byHand("/intern/activities", "Write entry");
      case "auto_duties":
      case "auto_evaluation":
        return status.done ? null : <span className="text-xs text-slate-500">Your supervisor adds this</span>;
      default:
        return null;
    }
  }

  async function saveTexts(e) {
    e.preventDefault();
    setSavingTexts(true);
    setTextsMsg("");
    try {
      const res = await apiFetch("/api/intern/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_texts: texts }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save your report texts.");
      setTextsMsg("Saved.");
      loadNarrative();
    } catch (err) {
      setTextsMsg(err.message);
    } finally {
      setSavingTexts(false);
    }
  }

  // Optional AI rewrite — only fills the box; nothing is saved until "Save texts".
  async function polishText(key) {
    if (!texts[key].trim()) return;
    setPolishing(key);
    setTextsMsg("");
    try {
      const res = await apiFetch("/api/intern/activities/polish-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: texts[key] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not polish this text.");
      setTexts((t) => ({ ...t, [key]: data.polished }));
    } catch (err) {
      setTextsMsg(err.message);
    } finally {
      setPolishing("");
    }
  }

  async function saveDetails(e) {
    e.preventDefault();
    setSavingDetails(true);
    setDetailsError("");
    try {
      const res = await apiFetch("/api/intern/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: details.title.trim() || undefined, bio: details.bio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save your details. Please try again.");
      setPortfolio(data.portfolio);
      setEditing(false);
    } catch (err) {
      setDetailsError(err.message || "Could not save your details. Please try again.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleAddItem(e) {
    e.preventDefault();
    if (!itemForm.title.trim()) {
      setError("Give this piece of work a title.");
      return;
    }
    setSavingItem(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("title", itemForm.title.trim());
      if (itemForm.description.trim()) formData.append("description", itemForm.description.trim());
      if (itemForm.project_url.trim()) formData.append("project_url", itemForm.project_url.trim());
      if (itemImage) formData.append("image", itemImage);

      const res = await apiFetch("/api/intern/portfolio/items", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not add this item.");
      setPortfolio((prev) => (prev ? { ...prev, items: [data.item, ...prev.items] } : prev));
      loadNarrative(); // the report checklist counts work samples too
      setItemForm({ title: "", description: "", project_url: "" });
      setItemImage(null);
      setShowItemForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingItem(false);
    }
  }

  async function handleItemImage(e) {
    const picked = await shrinkImage(e.target.files?.[0]);
    if (!picked) {
      setItemImage(null);
      return;
    }
    const validationError = validateImageFile(picked, MAX_ITEM_IMAGE_BYTES);
    if (validationError) {
      setError(validationError);
      e.target.value = "";
      setItemImage(null);
      return;
    }
    setError("");
    setItemImage(picked);
  }

  // Removes the work sample only once the server confirmed it; a failure keeps it on screen and says so.
  async function handleDeleteItem(item) {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`/api/intern/portfolio/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not remove this work sample. Please try again.");
      }
      setPortfolio((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev));
      loadNarrative(); // removing the last sample un-ticks "Samples of work done" in the checklist
      setDeleting(null);
    } catch (err) {
      setDeleteError(err.message || "Could not remove this work sample. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <Page size="narrow">
        <SkeletonList rows={3} height="h-32" />
      </Page>
    );
  }

  return (
    <Page size="narrow">
      <PageHeader
        title={portfolio?.title || "Your Portfolio"}
        sentence={portfolio?.bio || "Add a short bio to introduce your work."}
        meta="Visible to your supervisor and coordinator."
      >
        {!editing && (
          <Btn onClick={() => setEditing(true)}>
            <Pencil size={15} aria-hidden="true" /> Edit details
          </Btn>
        )}
        <Btn variant="primary" href="/intern/portfolio/report">
          <FileText size={15} aria-hidden="true" /> Generate Portfolio
        </Btn>
      </PageHeader>

      {editing && (
        <Section title="Edit details">
          <form onSubmit={saveDetails} className="grid gap-4">
            <FormField label="Portfolio title">
              <Input {...inputProps("title")}
                value={details.title}
                onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))}
                placeholder="Portfolio title"
              />
            </FormField>
            <FormField label="Short bio">
              <Textarea {...inputProps("longText")}
                value={details.bio}
                onChange={(e) => setDetails((d) => ({ ...d, bio: e.target.value }))}
                rows={3}
                placeholder="A short bio: who you are, what you're learning, what you're proud of."
              />
            </FormField>
            {detailsError && <p role="alert" className="k-note is-risk">{detailsError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Btn onClick={() => { setEditing(false); setDetailsError(""); }}>Cancel</Btn>
              <button type="submit" disabled={savingDetails} className="k-btn is-primary">
                {savingDetails ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Section>
      )}

      <Section
        title="Narrative report"
        help="Your school's printable OJT narrative report. Finish what it needs below, then use Generate Portfolio at the top."
      >
        {narrative && (
          <div className="mb-5">
            <NarrativeChecklist report={narrative} title="What your report needs" renderAction={checklistAction} />
          </div>
        )}

        <form onSubmit={saveTexts} className="grid gap-5">
          {[
            ["acknowledgement", "Acknowledgement"],
            ["personal_observation", "Personal observation"],
            ["suggestion", "Suggestion to improve the apprenticeship program"],
          ].map(([key, label]) => (
            <div key={key} className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label htmlFor={`report-${key}`} className="k-label min-w-0">{label}</label>
                <Btn variant="ghost" sm onClick={() => polishText(key)} disabled={polishing === key || !texts[key].trim()}>
                  <Sparkles size={14} aria-hidden="true" /> {polishing === key ? "Polishing…" : "Polish with AI"}
                </Btn>
              </div>
              <Textarea {...inputProps("longText")}
                id={`report-${key}`}
                value={texts[key]}
                onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
                rows={5}
                maxLength={5000}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={savingTexts} className="k-btn is-primary max-sm:w-full">
              {savingTexts ? "Saving…" : "Save texts"}
            </button>
            {textsMsg && <span role="status" className="text-sm text-slate-600">{textsMsg}</span>}
          </div>
        </form>
      </Section>

      <Section
        title="Work samples"
        action={
          <Btn variant={showItemForm ? "secondary" : "primary"} sm onClick={() => setShowItemForm((v) => !v)}>
            {showItemForm ? "Cancel" : <><Plus size={14} aria-hidden="true" /> Add item</>}
          </Btn>
        }
      >
        {showItemForm && (
          <form onSubmit={handleAddItem} className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-4">
            <FormField label="Title">
              <Input {...inputProps("title")}
                id="portfolio-item-title"
                value={itemForm.title}
                onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Company Attendance Module"
                autoFocus
              />
            </FormField>
            <FormField label="Description">
              <Textarea {...inputProps("longText")}
                value={itemForm.description}
                onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="What did you build or contribute?"
              />
            </FormField>
            <FormField label="Project link (optional)">
              <Input {...inputProps("url")}
                type="url"
                value={itemForm.project_url}
                onChange={(e) => setItemForm((f) => ({ ...f, project_url: clean("url", e.target.value) }))}
                placeholder="https://"
              />
            </FormField>
            <FormField label="Picture (optional)">
              <input type="file" accept="image/*" onChange={handleItemImage} className="k-input" />
            </FormField>
            {error && <p role="alert" className="k-note is-risk">{error}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={savingItem} className="k-btn is-primary max-sm:w-full">
                {savingItem ? "Adding…" : "Add to portfolio"}
              </button>
            </div>
          </form>
        )}

        {(portfolio?.items?.length ?? 0) === 0 ? (
          <EmptyState icon="portfolio" title="No work samples yet" text="Add your first one with the button above." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {portfolio.items.map((item) => (
              <div key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
                {item.image_url && <img src={item.image_url} alt="" className="h-36 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[0.9375rem] font-semibold text-slate-900">{item.title}</p>
                    <button type="button" onClick={() => { setDeleteError(""); setDeleting(item); }} className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center max-sm:min-h-[44px] max-sm:min-w-[44px] rounded-full text-slate-500 hover:bg-slate-50 hover:text-red-700" aria-label={`Remove ${item.title}`}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {item.description && <p className="mt-1 break-words text-sm text-slate-600">{item.description}</p>}
                  {item.project_url && (
                    <a href={item.project_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-blue-700 hover:underline sm:min-h-0">
                      View project <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this work sample?"
        confirmLabel="Remove"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => handleDeleteItem(deleting)}
        onCancel={() => setDeleting(null)}
      >
        <p>&ldquo;{deleting?.title}&rdquo; will be taken off your portfolio. You can add it again later.</p>
      </ConfirmDialog>
      {uploadType && (
        <UploadRequirementSheet
          documentType={uploadType}
          onClose={() => setUploadType("")}
          onUploaded={() => {
            setUploadType("");
            loadNarrative();
          }}
        />
      )}
    </Page>
  );
}
