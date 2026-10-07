"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { validateImageFile } from "@/lib/imageValidation";
import { shrinkImage } from "@/lib/imageCompress";
import Icon from "@/components/Icon";
import FileLink from "@/components/FileViewer";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";

import { inputProps } from "@/lib/inputRules";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  recorded: "bg-slate-100 text-slate-600",
};

const LIVE_TYPES = ["activity_reviewed"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_FORM = { activity_date: todayISO(), title: "", description: "" };

export default function DailyActivities() {
  const { user } = useCurrentUser();
  const aiEnabled = hasPlanFeature(user, PLAN_FEATURES.AI_FEATURES);
  const [activities, setActivities] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
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

  function load() {
    Promise.all([fetchInternData("activities"), fetchInternData("activities/suggestions")])
      .then(([a, s]) => {
        setActivities(a.activities ?? []);
        setSuggestions(s.suggestions ?? []);
      })
      .catch(() => {
        setActivities([]);
        setSuggestions([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(LIVE_TYPES, load);

  function applySuggestion(s) {
    setForm({ ...EMPTY_FORM, title: s.title, description: s.description ?? "" });
    setSource({ type: s.type, id: s.id });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
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
    if (!form.title.trim()) {
      setError("Give this entry a short title.");
      return;
    }
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
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Narrative Report</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Daily Activities</h1>
          <p className="mt-1 text-sm text-slate-600">Log what you accomplished today — your supervisor reviews these.</p>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ Log an entry"}
        </button>
      </section>

      {!loading && suggestions.length > 0 && !showForm && (
        <section className="rounded-3xl border border-blue-100 bg-blue-50/60 p-6">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-blue-800">
            <Icon name="spark" size={16} /> Finished today — log it as your narrative?
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={`${s.type}-${s.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{s.title}</p>
                  {s.context && <p className="text-xs text-slate-500">Subtask of: {s.context}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => applySuggestion(s)}
                  className="shrink-0 rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Use this
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {source && (
            <p className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
              <Icon name="check" size={12} /> Based on your finished {source.type === "task" ? "task" : "subtask"} — feel free to edit it below.
            </p>
          )}
          <label className="block max-w-xs text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Date</span>
            <input
              type="date"
              value={form.activity_date}
              max={todayISO()}
              onChange={(e) => setForm((f) => ({ ...f, activity_date: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Title</span>
            <input {...inputProps("title")}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Built the login page UI"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700">Narrative / reflection (optional)</span>
              {aiEnabled && (
                <button
                  type="button"
                  onClick={handlePolish}
                  disabled={polishing || !form.description.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="spark" size={12} /> {polishing ? "Polishing…" : "Improve with AI"}
                </button>
              )}
            </div>
            <textarea {...inputProps("longText")}
              value={form.description}
              onChange={(e) => {
                setForm((f) => ({ ...f, description: e.target.value }));
                setPolished(null);
              }}
              rows={4}
              placeholder="Describe what you did, what you learned, or any challenges you ran into…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
            {aiEnabled && (
              <span className="mt-1 block text-xs text-slate-400">
                Wrote it in Filipino or Taglish? Improve with AI turns it into clear, formal English for your portfolio — you choose whether to use it.
              </span>
            )}
          </label>

          {polished && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                <Icon name="spark" size={12} /> AI-polished version
              </p>
              <p className="whitespace-pre-line text-sm text-slate-700">{polished}</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={acceptPolished}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Use this version
                </button>
                <button
                  type="button"
                  onClick={() => setPolished(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                >
                  Keep mine
                </button>
              </div>
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Photo of today&apos;s work (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700"
            />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save entry"}
            </button>
          </div>
        </form>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Your entries</h2>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No entries yet — log your first one above.</p>
        ) : (
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="flex gap-3 rounded-2xl border border-slate-100 p-4">
                {a.photo_url && (
                  <FileLink url={a.photo_url} name={a.title} type="image/jpeg" className="shrink-0 cursor-zoom-in">
                    <img src={a.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                  </FileLink>
                )}
                <div className="min-w-0 flex-1">
                  {editingId === a.id ? (
                    <div className="space-y-2.5">
                      <input {...inputProps("title")}
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                      />
                      <textarea {...inputProps("longText")}
                        value={editForm.description}
                        onChange={(e) => { setEditForm((f) => ({ ...f, description: e.target.value })); setEditPolished(null); }}
                        rows={4}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                      {aiEnabled && !editPolished && (
                        <button
                          type="button"
                          onClick={handleEditPolish}
                          disabled={editPolishing || !editForm.description.trim()}
                          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Icon name="spark" size={12} /> {editPolishing ? "Polishing…" : "Improve with AI"}
                        </button>
                      )}
                      {editPolished && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                            <Icon name="spark" size={12} /> AI-polished version
                          </p>
                          <p className="whitespace-pre-line text-sm text-slate-700">{editPolished}</p>
                          <div className="mt-2.5 flex gap-2">
                            <button
                              type="button"
                              onClick={() => { setEditForm((f) => ({ ...f, description: editPolished })); setEditPolished(null); }}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              Use this version
                            </button>
                            <button type="button" onClick={() => setEditPolished(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white">
                              Keep mine
                            </button>
                          </div>
                        </div>
                      )}
                      {editError && <p className="text-xs text-red-600">{editError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveEdit(a.id)}
                          disabled={savingEdit}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button type="button" onClick={cancelEdit} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                            {a.is_auto_generated && (
                              <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                                <Icon name="spark" size={10} /> Auto-generated
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{a.activity_date}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {a.status}
                        </span>
                      </div>
                      {a.source_title && <p className="mt-1 text-xs text-slate-400">Based on: {a.source_title}</p>}
                      {a.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{a.description}</p>}
                      {a.status === "recorded" && (
                        <p className="mt-1.5 text-xs text-slate-400">
                          Recorded from your attendance and completed tasks that day — it already counts in your narrative report.
                          If you edit it to add your own context, it goes to your supervisor for approval.
                        </p>
                      )}
                      {a.status === "pending" && (
                        <p className="mt-1.5 text-xs text-slate-400">Waiting for your supervisor — it goes into your narrative report once approved.</p>
                      )}
                      {a.review_remarks && (
                        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <span className="font-semibold">Supervisor remarks:</span> {a.review_remarks}
                        </p>
                      )}
                      {a.editable && (
                        <button
                          type="button"
                          onClick={() => startEdit(a)}
                          className="mt-2 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
