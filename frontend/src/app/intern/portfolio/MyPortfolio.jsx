"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import NarrativeChecklist from "@/components/narrative-report/NarrativeChecklist";
import { fetchInternData } from "@/lib/internApi";
import { apiFetch } from "@/lib/apiFetch";
import { validateImageFile } from "@/lib/imageValidation";

import { clean, inputProps } from "@/lib/inputRules";
const MAX_ITEM_IMAGE_BYTES = 3 * 1024 * 1024;

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

  // Narrative report: texts the intern writes + what the report still lacks.
  const [texts, setTexts] = useState({ acknowledgement: "", personal_observation: "", suggestion: "" });
  const [savingTexts, setSavingTexts] = useState(false);
  const [textsMsg, setTextsMsg] = useState("");
  const [polishing, setPolishing] = useState("");
  const [narrative, setNarrative] = useState(null);

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
    try {
      const res = await apiFetch("/api/intern/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: details.title.trim() || undefined, bio: details.bio }),
      });
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setEditing(false);
      }
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
      setItemForm({ title: "", description: "", project_url: "" });
      setItemImage(null);
      setShowItemForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingItem(false);
    }
  }

  function handleItemImage(e) {
    const picked = e.target.files?.[0];
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

  async function handleDeleteItem(id) {
    setPortfolio((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));
    await apiFetch(`/api/intern/portfolio/items/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Portfolio</p>
            {editing ? (
              <form onSubmit={saveDetails} className="mt-2 space-y-3">
                <input {...inputProps("title")}
                  value={details.title}
                  onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Portfolio title"
                  className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold outline-none focus:border-blue-500"
                />
                <textarea {...inputProps("longText")}
                  value={details.bio}
                  onChange={(e) => setDetails((d) => ({ ...d, bio: e.target.value }))}
                  rows={3}
                  placeholder="A short bio — who you are, what you're learning, what you're proud of."
                  className="w-full max-w-lg rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={savingDetails} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {savingDetails ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="mt-1 text-2xl font-semibold text-slate-900">{portfolio?.title || "Your Portfolio"}</h1>
                <p className="mt-1 text-sm text-slate-600">{portfolio?.bio || "Add a short bio to introduce your work."}</p>
                <button type="button" onClick={() => setEditing(true)} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline">
                  <Icon name="gear" size={14} /> Edit details
                </button>
              </>
            )}
          </div>

          <Link
            href="/intern/portfolio/report"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Icon name="file" size={14} /> Generate Portfolio
          </Link>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <Icon name="user" size={12} /> Visible to your supervisor and coordinator.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Narrative report</h2>
            <p className="mt-1 text-sm text-slate-600">Your school&apos;s printable OJT narrative report. Write the parts only you can, then generate it.</p>
          </div>
          <Link href="/intern/portfolio/report" className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Generate Portfolio
          </Link>
        </div>

        {narrative && (
          <div className="mt-4">
            <NarrativeChecklist report={narrative} title="What your report needs" />
          </div>
        )}

        <form onSubmit={saveTexts} className="mt-4 space-y-4">
          {[
            ["acknowledgement", "Acknowledgement"],
            ["personal_observation", "Personal observation"],
            ["suggestion", "Suggestion to improve the apprenticeship program"],
          ].map(([key, label]) => (
            <label key={key} className="block text-sm">
              <span className="mb-1.5 flex items-center justify-between font-semibold text-slate-700">
                {label}
                <button
                  type="button"
                  onClick={() => polishText(key)}
                  disabled={polishing === key || !texts[key].trim()}
                  className="text-xs font-semibold text-blue-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                >
                  {polishing === key ? "Polishing…" : "Polish with AI"}
                </button>
              </span>
              <textarea {...inputProps("longText")}
                value={texts[key]}
                onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
                rows={5}
                maxLength={5000}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
          ))}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingTexts} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {savingTexts ? "Saving…" : "Save texts"}
            </button>
            {textsMsg && <span className="text-sm text-slate-600">{textsMsg}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Work samples</h2>
          <button
            type="button"
            onClick={() => setShowItemForm((v) => !v)}
            className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {showItemForm ? "Cancel" : "+ Add item"}
          </button>
        </div>

        {showItemForm && (
          <form onSubmit={handleAddItem} className="mb-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input {...inputProps("title")}
              value={itemForm.title}
              onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title, e.g. Company Attendance Module"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
            <textarea {...inputProps("longText")}
              value={itemForm.description}
              onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="What did you build or contribute?"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <input {...inputProps("url")}
              type="url"
              value={itemForm.project_url}
              onChange={(e) => setItemForm((f) => ({ ...f, project_url: clean("url", e.target.value) }))}
              placeholder="Project link (optional)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <input
              type="file"
              accept="image/*"
              onChange={handleItemImage}
              className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700"
            />
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={savingItem} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {savingItem ? "Adding…" : "Add to portfolio"}
            </button>
          </form>
        )}

        {(portfolio?.items?.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No work samples yet — add your first one above.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {portfolio.items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200">
                {item.image_url && <img src={item.image_url} alt="" className="h-36 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <button type="button" onClick={() => handleDeleteItem(item.id)} className="shrink-0 text-slate-400 hover:text-red-600" aria-label={`Remove ${item.title}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {item.description && <p className="mt-1 text-xs text-slate-600">{item.description}</p>}
                  {item.project_url && (
                    <a href={item.project_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-blue-600 hover:underline">
                      View project ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
