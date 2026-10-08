"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { apiFetch } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { inputProps } from "@/lib/inputRules";

const fieldClass = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500";
const iconButton =
  "grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 text-base text-slate-600 hover:bg-slate-50 disabled:opacity-30 sm:h-9 sm:w-9";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Ticked requirements first (in the saved order), then everything else the school can choose from.
function buildItems(course, meta, extraNames = []) {
  const ticked = course?.requirements ?? [];
  const builtin = new Set((meta?.choices ?? []).filter((c) => c.builtin).map((c) => norm(c.name)));
  const items = ticked.map((name) => ({ name, ticked: true, builtin: builtin.has(norm(name)) }));
  const have = new Set(items.map((i) => norm(i.name)));
  for (const c of [...(meta?.choices ?? []), ...extraNames.map((name) => ({ name, builtin: false }))]) {
    if (!have.has(norm(c.name))) {
      have.add(norm(c.name));
      items.push({ name: c.name, ticked: false, builtin: Boolean(c.builtin) });
    }
  }
  return items;
}

const signature = (items) => JSON.stringify(items.filter((i) => i.ticked).map((i) => i.name));

export default function CourseRequirementsCard() {
  const [meta, setMeta] = useState(null);
  const [course, setCourse] = useState("");
  const [items, setItems] = useState([]);
  const [baseline, setBaseline] = useState("[]");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // { name, value }
  const [copyFrom, setCopyFrom] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind: "switch"|"reset", course? }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const current = meta?.courses.find((c) => c.name === course);
  const dirty = signature(items) !== baseline;
  const max = meta?.max_requirements ?? 30;
  const maxName = meta?.max_name_length ?? 100;
  const tickedCount = items.filter((i) => i.ticked).length;

  function select(next, data = meta) {
    const c = data.courses.find((x) => x.name === next);
    const rows = buildItems(c, data);
    setCourse(next);
    setItems(rows);
    setBaseline(signature(rows));
    setNewName("");
    setEditing(null);
    setCopyFrom("");
  }

  useEffect(() => {
    fetchCoordinatorData("course-requirements")
      .then((data) => {
        setMeta(data);
        // Start on the course with the most interns.
        const first = [...data.courses].sort((a, b) => b.interns_count - a.interns_count)[0];
        if (first) select(first.name, data);
      })
      .catch(() => setError("Could not load the requirements."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyServer(data, keepCourse = course) {
    setMeta(data);
    select(data.courses.some((c) => c.name === keepCourse) ? keepCourse : data.courses[0]?.name ?? "", data);
  }

  function chooseCourse(next) {
    if (next === course) return;
    setMessage("");
    setError("");
    if (dirty) setConfirm({ kind: "switch", course: next });
    else select(next);
  }

  function toggle(name) {
    setMessage("");
    const target = items.find((i) => i.name === name);
    if (!target) return;
    if (!target.ticked && tickedCount >= max) {
      setError(`A course can have at most ${max} requirements.`);
      return;
    }
    setError("");
    setItems((list) => list.map((i) => (i.name === name ? { ...i, ticked: !i.ticked } : i)));
  }

  function move(index, dir) {
    setItems((list) => {
      const to = index + dir;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  }

  function nameProblem(value, ignore = "") {
    const name = tidy(value);
    if (!name) return "Type a name first.";
    if (name.length > maxName) return `A requirement name can have at most ${maxName} characters.`;
    if (norm(name) === "other") return '"Other" cannot be used as a requirement name.';
    if (items.some((i) => norm(i.name) === norm(name) && norm(i.name) !== norm(ignore))) return `"${name}" is already in the list.`;
    return "";
  }

  function addCustom(e) {
    e.preventDefault();
    setMessage("");
    const existing = items.find((i) => norm(i.name) === norm(newName));
    if (existing && !existing.ticked && tidy(newName)) {
      toggle(existing.name);
      setNewName("");
      return;
    }
    const problem = nameProblem(newName);
    if (problem) {
      setError(problem);
      return;
    }
    if (tickedCount >= max) {
      setError(`A course can have at most ${max} requirements.`);
      return;
    }
    setError("");
    setItems((list) => [...list, { name: tidy(newName), ticked: true, builtin: false }]);
    setNewName("");
  }

  function removeCustom(name) {
    setMessage("");
    setItems((list) => list.filter((i) => i.name !== name));
  }

  async function submitRename(e) {
    e.preventDefault();
    const { name, value } = editing;
    const problem = nameProblem(value, name);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    const to = tidy(value);
    if (to === name) {
      setEditing(null);
      return;
    }
    const savedOnServer = meta.choices.some((c) => !c.builtin && norm(c.name) === norm(name));
    if (!savedOnServer) {
      // Only in this unsaved draft: rename it here.
      setItems((list) => list.map((i) => (i.name === name ? { ...i, name: to } : i)));
      setEditing(null);
      return;
    }
    if (dirty) {
      setError("Save or discard your other changes first, then rename.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/coordinator/course-requirements/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: name, to }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not rename this requirement.");
      applyServer(data);
      setMessage(`Renamed to "${to}" in every course. Files already uploaded under the old name follow it.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    const source = meta.courses.find((c) => c.name === copyFrom);
    if (!source) return;
    const extras = items.map((i) => i.name);
    const rows = buildItems(source, meta, extras);
    // Anything typed as a draft but not ticked in the source stays available, unticked.
    setItems(rows);
    setCopyFrom("");
    setMessage(`Copied the ticks from ${source.name}. Save to apply them to ${course}.`);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/coordinator/course-requirements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course, requirements: items.filter((i) => i.ticked).map((i) => i.name) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.errors?.requirements?.[0] || data.message || "Could not save the requirements.");
      applyServer(data);
      setMessage(data.message || "Saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/coordinator/course-requirements?course=${encodeURIComponent(course)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not reset.");
      applyServer(data);
      setMessage(data.message || "Reset.");
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const otherCourses = useMemo(() => (meta?.courses ?? []).filter((c) => c.name !== course), [meta, course]);

  if (!meta) {
    return <p className="mt-6 text-sm text-slate-400">{error || "Loading…"}</p>;
  }

  return (
    <div className="mt-2">
      <h2 className="text-xl font-semibold text-slate-900">Requirements per course</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pick a course, then tick the documents its interns must submit. Interns see this list on their Documents page, and the missing-documents
        alerts follow it.
      </p>

      <div className="mt-5 max-w-xl rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Course</span>
          <select value={course} onChange={(e) => chooseCourse(e.target.value)} className={fieldClass} disabled={busy}>
            {meta.courses.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.interns_count} {c.interns_count === 1 ? "intern" : "interns"}){c.configured ? "" : " - default"}
              </option>
            ))}
          </select>
        </label>

        {current && !current.configured && (
          <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {course} uses the system default right now. Change the ticks and save to set your own list.
          </p>
        )}

        <div className="mt-4 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Required documents</h3>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{tickedCount}</span> required
          </p>
        </div>

        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {items.map((item, index) => (
            <li key={item.name} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${item.ticked ? "bg-white" : "bg-slate-50/60"}`}>
              {editing?.name === item.name ? (
                <form onSubmit={submitRename} className="flex w-full flex-wrap items-center gap-2">
                  <input
                    {...inputProps("shortText")}
                    value={editing.value}
                    onChange={(e) => setEditing({ name: item.name, value: e.target.value })}
                    maxLength={maxName}
                    aria-label={`New name for ${item.name}`}
                    className={`${fieldClass} min-w-0 flex-1`}
                    autoFocus
                  />
                  <button type="submit" disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    Rename
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <label className="flex min-h-12 min-w-[10rem] flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.ticked}
                      onChange={() => toggle(item.name)}
                      className="h-6 w-6 shrink-0 rounded border-slate-300 accent-blue-600"
                    />
                    <span className="min-w-0 break-words text-sm font-medium text-slate-900">
                      {item.name}
                      {!item.builtin && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-violet-700">Custom</span>}
                    </span>
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    {item.ticked && (
                      <>
                        <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${item.name} up`} className={iconButton}>
                          ↑
                        </button>
                        <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${item.name} down`} className={iconButton}>
                          ↓
                        </button>
                      </>
                    )}
                    {!item.builtin && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setEditing({ name: item.name, value: item.name });
                          }}
                          className="min-h-12 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-9"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCustom(item.name)}
                          className="min-h-12 rounded-xl border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 sm:min-h-9"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={addCustom} className="mt-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Add your own requirement</span>
            <div className="flex gap-2">
              <input
                {...inputProps("shortText")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={maxName}
                placeholder="e.g. Parent's Consent"
                className={`${fieldClass} min-w-0 flex-1`}
              />
              <button type="submit" className="shrink-0 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                Add
              </button>
            </div>
          </label>
        </form>

        {otherCourses.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block min-w-[10rem] flex-1 text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Copy from another course</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={fieldClass}>
                <option value="">Choose a course…</option>
                {otherCourses.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.requirements.length} required)
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={copy}
              disabled={!copyFrom}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Copy
            </button>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {current?.configured ? (
            <button type="button" onClick={() => setConfirm({ kind: "reset" })} disabled={busy} className="text-sm font-semibold text-slate-600 hover:underline disabled:opacity-50">
              Back to default
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : dirty ? "Save requirements" : "Saved"}
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Unticking or removing a requirement never deletes files interns already uploaded. Interns without a course use the default list.
        </p>
      </div>

      <ConfirmDialog
        open={confirm?.kind === "switch"}
        title="Discard your changes?"
        confirmLabel="Discard and switch"
        onConfirm={() => {
          const next = confirm.course;
          setConfirm(null);
          select(next);
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>You changed the list for {course} but did not save it. Switching to another course throws those changes away.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === "reset"}
        title={`Back to the default for ${course}?`}
        confirmLabel="Use the default"
        busy={busy}
        onConfirm={resetToDefault}
        onCancel={() => setConfirm(null)}
      >
        <p>{course} goes back to the system default list. Files interns already uploaded are not deleted.</p>
      </ConfirmDialog>
    </div>
  );
}
