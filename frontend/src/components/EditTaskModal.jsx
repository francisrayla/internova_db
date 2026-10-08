"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { inputProps } from "@/lib/inputRules";

/**
 * Supervisor fixes a task's details after assigning it (title, description, priority, due date).
 * Who it is assigned to and its status are not editable here. The backend refuses once the task is rated.
 */
export default function EditTaskModal({ task, apiBase, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task.title ?? "",
    description: task.description ?? "",
    priority: task.priority ?? "medium",
    due_date: task.due_date_raw ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Enter a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${apiBase}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, due_date: form.due_date || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const first = data.errors ? Object.values(data.errors).flat()[0] : null;
        throw new Error(first || data.message || "Could not save the changes.");
      }
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="sheet-panel max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:rounded-3xl sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">Edit task</h3>
        <p className="mt-1 text-xs text-slate-500">The interns on this task are notified of the change. You can edit until you rate the task.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Title</span>
            <input {...inputProps("title")} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-blue-500 sm:text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Description</span>
            <textarea {...inputProps("longText")} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-blue-500 sm:text-sm" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Priority</span>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-blue-500 sm:text-sm">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Due date</span>
              <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-blue-500 sm:text-sm" />
            </label>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
