"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { inputProps } from "@/lib/inputRules";
import { manilaToday } from "@/lib/dueDateUrgency";
import { Banner } from "@/components/ui";
import { Btn, FormField, Input, Select, SheetFrame, Textarea } from "@/components/dash/page";

/**
 * Supervisor fixes a task's details after assigning it (title, description, priority, due date).
 * Who it is assigned to and its status are not editable here. The backend refuses once the task is rated.
 * The due date can stay, move forward (never before today in Manila, never before the date already set) or be cleared
 * (no due date). An overdue task keeps its old date untouched; to change it, pick today or later.
 */
export function dueDateProblem(value, original, today = manilaToday()) {
  if (value === (original || "")) return "";
  if (!value) return ""; // cleared: the task simply has no due date
  if (value < today) return "The due date cannot be in the past. Choose today or a later date.";
  if (original && value < original) return "The due date can only be moved forward from the current one.";
  return "";
}

export default function EditTaskModal({ task, apiBase, onClose, onSaved }) {
  const today = manilaToday();
  const original = task.due_date_raw ?? "";
  const minDue = original && original > today ? original : today;
  const [form, setForm] = useState({
    title: task.title ?? "",
    description: task.description ?? "",
    priority: task.priority ?? "medium",
    due_date: task.due_date_raw ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dueProblem = dueDateProblem(form.due_date, original, today);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Enter a title.");
      return;
    }
    if (dueProblem) {
      setError(dueProblem);
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
    <SheetFrame
      title="Edit task"
      description="The interns on this task are notified of the change. You can edit until you rate the task."
      onClose={onClose}
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving || !!dueProblem}>{saving ? "Saving…" : "Save changes"}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Title">
          <Input {...inputProps("title")} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </FormField>
        <FormField label="Description">
          <Textarea {...inputProps("longText")} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
        </FormField>
        <div className="grid grid-cols-1 items-start gap-4">
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </FormField>
          <FormField
            label="Due date"
            error={dueProblem}
            hint={!dueProblem ? (original && original < today ? "This task is overdue. Keep the date, pick today or a later date, or clear it." : original ? "Keep it, move it later, or clear it." : "Pick today or a later date, or clear it.") : undefined}
          >
            <div className="flex items-stretch gap-2">
              <Input type="date" min={minDue} value={form.due_date} aria-invalid={!!dueProblem} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
              <Btn className="shrink-0" onClick={() => setForm((f) => ({ ...f, due_date: "" }))} disabled={!form.due_date}>Clear date</Btn>
            </div>
          </FormField>
        </div>
        {error && <Banner tone="red">{error}</Banner>}
      </div>
    </SheetFrame>
  );
}
