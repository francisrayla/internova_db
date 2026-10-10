"use client";

import { useEffect, useRef, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { validateImageFile } from "@/lib/imageValidation";
import { shrinkImage } from "@/lib/imageCompress";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { Btn, DataList, DataRow, EmptyState, FormField, Input, Page, PageHeader, Pill, Section, SkeletonList, Textarea } from "@/components/dash/page";
import FileLink from "@/components/FileViewer";
import { LoadMore } from "@/components/Pagination";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";
import { manilaToday } from "@/lib/dueDateUrgency";
import { syncTrustedClock } from "@/lib/trustedClock";

import { inputProps } from "@/lib/inputRules";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const STATUS_TONES = { pending: "amber", approved: "green", rejected: "red", recorded: "slate" };

const LIVE_TYPES = ["activity_reviewed"];

// "Today" is the Philippine date (the same one the server uses), not the phone's own date.
function todayISO() {
  return manilaToday();
}

const emptyForm = () => ({ activity_date: todayISO(), title: "", description: "" });

export default function DailyActivities() {
  const { user } = useCurrentUser();
  const aiEnabled = hasPlanFeature(user, PLAN_FEATURES.AI_FEATURES);
  const [activities, setActivities] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const requestRef = useRef(0);
  const submittingRef = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [source, setSource] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polished, setPolished] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", description: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [editPolishing, setEditPolishing] = useState(false);
  const [editPolished, setEditPolished] = useState(null);

  // Page 1 replaces the list (first load, saved/edited entry, live update); a later page is appended.
  function load(nextPage = 1) {
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    Promise.all([fetchInternData(`activities?page=${nextPage}`), nextPage === 1 ? fetchInternData("activities/suggestions") : Promise.resolve(null)])
      .then(([a, s]) => {
        if (request !== requestRef.current) return;
        const rows = a.activities ?? [];
        setActivities((prev) => {
          if (nextPage === 1) return rows;
          const have = new Set(prev.map((x) => x.id));
          return [...prev, ...rows.filter((x) => !have.has(x.id))];
        });
        if (s) setSuggestions(s.suggestions ?? []);
        setPage(nextPage);
        setHasMore(Boolean(a.has_more));
        setTotal(a.total ?? rows.length);
      })
      .catch(() => {
        if (request !== requestRef.current || nextPage > 1) return;
        setActivities([]);
        setSuggestions([]);
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }

  function refresh() {
    load(1);
  }

  function loadMore() {
    setLoadingMore(true);
    load(page + 1);
  }

  useEffect(() => {
    load(1);
    // Anchor "today" to the server clock so a wrong phone date cannot shift it.
    syncTrustedClock().then(() => setForm((f) => (f.title || f.description ? f : { ...f, activity_date: todayISO() })));
  }, []);
  useLiveRefresh(LIVE_TYPES, refresh);

  function applySuggestion(s) {
    setForm({ ...emptyForm(), title: s.title, description: s.description ?? "" });
    setSource({ type: s.type, id: s.id });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setForm(emptyForm());
    setSource(null);
    setPhoto(null);
    setError("");
    setPolished(null);
  }

  // Shared by the new-entry form and Edit: returns the AI's English rewrite,
  // which the intern then chooses to use or ignore.
  async function requestPolish(text) {
    const res = await apiFetch("/api/intern/activities/polish-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Could not polish this right now.");
    return data.polished;
  }

  async function handleEditPolish() {
    if (!editForm.description.trim()) {
      setEditError("Write a narrative first, then let AI help polish it.");
      return;
    }
    setEditPolishing(true);
    setEditError("");
    setEditPolished(null);
    try {
      setEditPolished(await requestPolish(editForm.description));
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditPolishing(false);
    }
  }

  async function handlePolish() {
    if (!form.description.trim()) {
      setError("Write a narrative first, then let AI help polish it.");
      return;
    }
    setPolishing(true);
    setError("");
    setPolished(null);
    try {
      setPolished(await requestPolish(form.description));
    } catch (err) {
      setError(err.message);
    } finally {
      setPolishing(false);
    }
  }

  function acceptPolished() {
    setForm((f) => ({ ...f, description: polished }));
    setPolished(null);
  }

  function startEdit(a) {
    setEditPolished(null);
    setEditingId(a.id);
    setEditForm({ title: a.title, description: a.description ?? "" });
    setEditError("");
  }

  function cancelEdit() {
    setEditPolished(null);
    setEditingId(null);
    setEditForm({ title: "", description: "" });
    setEditError("");
  }

  async function saveEdit(id) {
    if (!editForm.title.trim()) {
      setEditError("Give this entry a short title.");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const res = await apiFetch(`/api/intern/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editForm.title.trim(), description: editForm.description.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this entry.");
      cancelEdit();
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handlePhoto(e) {
    const picked = await shrinkImage(e.target.files?.[0]);
    if (!picked) {
      setPhoto(null);
      return;
    }
    const validationError = validateImageFile(picked, MAX_PHOTO_BYTES);
    if (validationError) {
      setError(validationError);
      e.target.value = "";
      setPhoto(null);
      return;
    }
    setError("");
    setPhoto(picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // a double tap lands before the button is disabled
    if (!form.title.trim()) {
      setError("Give this entry a short title.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("activity_date", form.activity_date);
      formData.append("title", form.title.trim());
      if (form.description.trim()) formData.append("description", form.description.trim());
      if (photo) formData.append("photo", photo);
      if (source?.type === "task") formData.append("source_task_id", String(source.id));
      if (source?.type === "subtask") formData.append("source_subtask_id", String(source.id));

      const res = await apiFetch("/api/intern/activities", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this entry.");
      cancelForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Page size="narrow">
      <PageHeader title="Daily activities" sentence="Log what you accomplished today. Your supervisor reviews these.">
        <Btn variant={showForm ? "secondary" : "primary"} onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
          {showForm ? "Cancel" : <><Plus size={16} aria-hidden="true" /> Log an entry</>}
        </Btn>
      </PageHeader>

      {!loading && suggestions.length > 0 && !showForm && (
        <Section flush title="Finished today. Log it as your narrative?">
          <DataList>
            {suggestions.map((s) => (
              <DataRow
                key={`${s.type}-${s.id}`}
                title={s.title}
                sub={s.context ? `Subtask of: ${s.context}` : undefined}
                actions={<Btn sm onClick={() => applySuggestion(s)}>Use this</Btn>}
              />
            ))}
          </DataList>
        </Section>
      )}

      {showForm && (
        <Section title="New entry">
          <form onSubmit={handleSubmit} className="grid gap-4">
            {source && (
              <p className="k-note">
                Based on your finished {source.type === "task" ? "task" : "subtask"}. Feel free to edit it below.
              </p>
            )}
            <FormField label="Date" className="sm:max-w-xs">
              <Input
                type="date"
                value={form.activity_date}
                max={todayISO()}
                onChange={(e) => setForm((f) => ({ ...f, activity_date: e.target.value }))}
              />
            </FormField>
            <FormField label="Title">
              <Input {...inputProps("title")}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Built the login page UI"
                autoFocus
              />
            </FormField>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="act-narrative" className="k-label">Narrative / reflection (optional)</label>
                {aiEnabled && (
                  <Btn sm onClick={handlePolish} disabled={polishing || !form.description.trim()}>
                    <Sparkles size={14} aria-hidden="true" /> {polishing ? "Polishing…" : "Improve with AI"}
                  </Btn>
                )}
              </div>
              <Textarea {...inputProps("longText")}
                id="act-narrative"
                value={form.description}
                onChange={(e) => {
                  setForm((f) => ({ ...f, description: e.target.value }));
                  setPolished(null);
                }}
                rows={5}
                placeholder="Describe what you did, what you learned, or any challenges you ran into…"
              />
              {aiEnabled && (
                <span className="k-hint">
                  Wrote it in Filipino or Taglish? Improve with AI turns it into clear, formal English for your portfolio. You choose whether to use it.
                </span>
              )}
            </div>

            {polished && (
              <div className="rounded-xl bg-blue-50 p-3.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-blue-800">
                  <Sparkles size={14} aria-hidden="true" /> AI-polished version
                </p>
                <p className="whitespace-pre-line text-sm text-slate-700">{polished}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn variant="primary" sm onClick={acceptPolished}>Use this version</Btn>
                  <Btn sm onClick={() => setPolished(null)}>Keep mine</Btn>
                </div>
              </div>
            )}
            <FormField label="Photo of today's work (optional)">
              <input type="file" accept="image/*" onChange={handlePhoto} className="k-input" />
            </FormField>
            {error && <p role="alert" className="k-note is-risk">{error}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="k-btn is-primary max-sm:w-full">
                {saving ? "Saving…" : "Save entry"}
              </button>
            </div>
          </form>
        </Section>
      )}

      <Section flush title="Your entries">
        {loading ? (
          <div className="k-pad"><SkeletonList rows={2} height="h-24" /></div>
        ) : activities.length === 0 ? (
          <div className="k-pad"><EmptyState icon="activities" title="No entries yet" text="Log your first one with the button above." /></div>
        ) : (
          <ul className="k-list">
            {activities.map((a) => (
              <li key={a.id} className="k-item flex gap-3">
                {a.photo_url && (
                  <FileLink url={a.photo_url} name={a.title} type="image/jpeg" className="shrink-0 cursor-zoom-in">
                    <img src={a.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                  </FileLink>
                )}
                <div className="min-w-0 flex-1">
                  {editingId === a.id ? (
                    <div className="grid gap-3">
                      <Input {...inputProps("title")}
                        aria-label="Title"
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      />
                      <Textarea {...inputProps("longText")}
                        aria-label="Narrative"
                        value={editForm.description}
                        onChange={(e) => { setEditForm((f) => ({ ...f, description: e.target.value })); setEditPolished(null); }}
                        rows={5}
                      />
                      {aiEnabled && !editPolished && (
                        <div>
                          <Btn sm onClick={handleEditPolish} disabled={editPolishing || !editForm.description.trim()}>
                            <Sparkles size={14} aria-hidden="true" /> {editPolishing ? "Polishing…" : "Improve with AI"}
                          </Btn>
                        </div>
                      )}
                      {editPolished && (
                        <div className="rounded-xl bg-blue-50 p-3.5">
                          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-blue-800">
                            <Sparkles size={14} aria-hidden="true" /> AI-polished version
                          </p>
                          <p className="whitespace-pre-line text-sm text-slate-700">{editPolished}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Btn variant="primary" sm onClick={() => { setEditForm((f) => ({ ...f, description: editPolished })); setEditPolished(null); }}>
                              Use this version
                            </Btn>
                            <Btn sm onClick={() => setEditPolished(null)}>Keep mine</Btn>
                          </div>
                        </div>
                      )}
                      {editError && <p role="alert" className="k-error">{editError}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Btn variant="primary" sm onClick={() => saveEdit(a.id)} disabled={savingEdit}>
                          {savingEdit ? "Saving…" : "Save"}
                        </Btn>
                        <Btn sm onClick={cancelEdit}>Cancel</Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                        <div className="min-w-0">
                          <p className="break-words text-[0.9375rem] font-semibold text-slate-900">{a.title}</p>
                          <p className="text-sm text-slate-500">{a.activity_date}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {a.is_auto_generated && (
                            <Pill tone="blue" size="sm"><Sparkles size={11} aria-hidden="true" className="mr-1" /> Auto-generated</Pill>
                          )}
                          <Pill tone={STATUS_TONES[a.status] ?? "slate"} className="capitalize">{a.status}</Pill>
                        </div>
                      </div>
                      {a.source_title && <p className="mt-1 text-sm text-slate-500">Based on: {a.source_title}</p>}
                      {a.description && <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">{a.description}</p>}
                      {a.status === "recorded" && (
                        <p className="mt-2 text-sm text-slate-500">
                          Recorded from your attendance and completed tasks that day. It already counts in your narrative report.
                          If you edit it to add your own context, it goes to your supervisor for approval.
                        </p>
                      )}
                      {a.status === "pending" && (
                        <p className="mt-2 text-sm text-slate-500">Waiting for your supervisor. It goes into your narrative report once approved.</p>
                      )}
                      {a.review_remarks && (
                        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <span className="font-semibold">Supervisor remarks:</span> {a.review_remarks}
                        </p>
                      )}
                      {a.editable && (
                        <div className="mt-2">
                          <Btn variant="ghost" sm onClick={() => startEdit(a)} className="-ml-3">
                            <Pencil size={14} aria-hidden="true" /> Edit
                          </Btn>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && <LoadMore shown={activities.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />}
      </Section>
    </Page>
  );
}
