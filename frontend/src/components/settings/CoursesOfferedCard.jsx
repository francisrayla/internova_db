"use client";

import { useEffect, useMemo, useState } from "react";
import { GraduationCap, Plus, X } from "lucide-react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";
import { makeCourseResolver } from "@/lib/schoolCourses";
import { clean, inputProps } from "@/lib/inputRules";
import { Btn, EmptyState, FormField, Input, Page, PageHeader, Pill, SearchField, Section } from "@/components/dash/page";

const NAME_PATTERN = /^[\p{L}\p{M}\p{N} .,&()'-]+$/u;
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What goes to the API for one picked course: null when the figure is the catalog default. */
const hoursToSend = (p) => (Number(p.hours) === p.defaultHours ? null : Number(p.hours));
const signature = (picked) => JSON.stringify(picked.map((p) => [p.name.toLowerCase(), hoursToSend(p)]));

function fromServer(data) {
  const counts = new Map();
  for (const o of data.offered) counts.set(o.name.toLowerCase(), o.interns_count);
  for (const u of data.unlisted ?? []) counts.set(u.name.toLowerCase(), u.interns_count);
  const picked = data.offered.map((o) => ({
    name: o.name,
    code: o.code,
    custom: o.custom,
    defaultHours: o.default_hours,
    hours: String(o.hours),
    interns: o.interns_count,
  }));
  return { picked, counts };
}

/**
 * "Courses offered": the school picks, from a catalog grouped by field (or by typing its own program), the
 * courses it really offers. Only these appear when interns are added or imported. Shared by the coordinator
 * (/coordinator/settings/courses) and the school head (/dean/settings/courses); `role` picks the API and the way back.
 */
export default function CoursesOfferedCard({ role = "coordinator" }) {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState([]);
  const [counts, setCounts] = useState(() => new Map());
  const [baseline, setBaseline] = useState("[]");
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function load(next) {
    const { picked: p, counts: c } = fromServer(next);
    setData(next);
    setPicked(p);
    setCounts(c);
    setBaseline(signature(p));
    const names = new Set(p.map((x) => x.name.toLowerCase()));
    setOpenGroups(new Set(next.catalog.filter((g) => g.courses.some((c) => names.has(c.name.toLowerCase()))).map((g) => g.label)));
  }

  useEffect(() => {
    let alive = true;
    fetchApiData(role, "school-courses")
      .then((d) => { if (alive) load(d); })
      .catch((err) => { if (alive) setLoadError(err.message || "Could not load your school's courses."); });
    return () => { alive = false; };
  }, [role]);

  const limits = data?.limits ?? { max_courses: 100, max_name_length: 150, min_hours: 1, max_hours: 2000, default_hours: 500 };
  const canonical = useMemo(() => makeCourseResolver(data?.catalog), [data]);
  const catalogByName = useMemo(() => new Map((data?.catalog ?? []).flatMap((g) => g.courses).map((c) => [c.name.toLowerCase(), c])), [data]);
  const pickedKeys = useMemo(() => new Set(picked.map((p) => p.name.toLowerCase())), [picked]);
  const dirty = signature(picked) !== baseline;

  const hoursProblem = (p) => {
    const n = Number(p.hours);
    if (p.hours === "" || !Number.isInteger(n) || n < limits.min_hours || n > limits.max_hours) return `Enter ${limits.min_hours} to ${limits.max_hours} hours.`;
    return "";
  };
  const hasHoursProblem = picked.some((p) => hoursProblem(p));

  // Courses the school offers today (saved) that the draft drops while interns still have them.
  const droppedWithInterns = useMemo(
    () => (data?.offered ?? []).filter((o) => !pickedKeys.has(o.name.toLowerCase()) && o.interns_count > 0),
    [data, pickedKeys]
  );
  // Courses interns still have that are not offered and not in the draft.
  const leftovers = useMemo(
    () => (data?.unlisted ?? []).filter((u) => !pickedKeys.has(u.name.toLowerCase())),
    [data, pickedKeys]
  );

  function add(course) {
    setMessage("");
    if (picked.length >= limits.max_courses) {
      setError(`A school can offer at most ${limits.max_courses} courses.`);
      return false;
    }
    setError("");
    setPicked((list) => [
      ...list,
      {
        name: course.name,
        code: course.code ?? null,
        custom: !course.code,
        defaultHours: course.default_hours ?? limits.default_hours,
        hours: String(course.hours ?? course.default_hours ?? limits.default_hours),
        interns: counts.get(course.name.toLowerCase()) ?? 0,
      },
    ]);
    return true;
  }

  function remove(name) {
    setMessage("");
    setError("");
    setPicked((list) => list.filter((p) => p.name !== name));
  }

  function toggle(course) {
    if (pickedKeys.has(course.name.toLowerCase())) remove(picked.find((p) => p.name.toLowerCase() === course.name.toLowerCase()).name);
    else add(course);
  }

  function addCustom(e) {
    e.preventDefault();
    const text = tidy(custom);
    if (!text) return setError("Type the name of the program first.");
    if (text.length > limits.max_name_length) return setError(`A course name can have at most ${limits.max_name_length} characters.`);
    if (!NAME_PATTERN.test(text)) return setError("A course name can only have letters, numbers, spaces and . , & ( ) - '");
    const name = canonical(text);
    if (pickedKeys.has(name.toLowerCase())) return setError(`"${name}" is already in your list.`);
    if (add(catalogByName.get(name.toLowerCase()) ?? { name, code: null, default_hours: limits.default_hours })) setCustom("");
  }

  function setHours(name, value) {
    setMessage("");
    setPicked((list) => list.map((p) => (p.name === name ? { ...p, hours: value.replace(/[^\d]/g, "").slice(0, 4) } : p)));
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`/api/${role}/school-courses`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ offered: picked.map((p) => ({ name: p.name, required_hours: hoursToSend(p) })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        const first = body.errors ? Object.values(body.errors).flat()[0] : null;
        throw new Error(first || body.message || "Could not save your courses.");
      }
      load(body);
      const updated = Number(body.interns_updated) || 0;
      setMessage(
        (picked.length === 0 ? "Saved. No courses are offered right now, so no new interns can be added until you pick some." : "Saved. These are the courses that now appear when you add or import interns.")
          + (updated > 0 ? ` Required hours updated for ${updated} intern${updated === 1 ? "" : "s"}.` : "")
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      back={{ href: `/${role}/settings`, label: "Settings" }}
      title="Courses offered"
      sentence="Pick the courses your school offers. Only these appear when you add or import interns."
    />
  );

  if (!data) {
    return (
      <Page className="max-w-4xl">
        {header}
        {loadError ? <p role="alert" className="k-note is-risk">{loadError}</p> : <p className="text-sm text-slate-600" role="status">Loading…</p>}
      </Page>
    );
  }

  const q = tidy(search).toLowerCase();
  const searching = q !== "";
  const groups = data.catalog
    .map((g) => ({
      ...g,
      shown: g.courses.filter((c) => !searching || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))),
    }))
    .filter((g) => g.shown.length > 0);

  return (
    <Page className="max-w-4xl">
      {header}

      <Section
        title={`Your courses (${picked.length})`}
        help="Required hours is what each intern in the course must complete. It starts at the usual figure. Changing it also updates the interns who already have the course, except those already completed."
      >
        {picked.length === 0 ? (
          <EmptyState
            icon="graduation"
            title="No courses picked yet"
            text="Pick the courses your school offers from the list below, or add your own. Only these appear when you add or import interns."
          />
        ) : (
          <ul className="k-list overflow-hidden rounded-xl border border-slate-200">
            {picked.map((p) => {
              const problem = hoursProblem(p);
              return (
                <li key={p.name} className="flex flex-wrap items-end gap-x-4 gap-y-2 px-3 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words text-sm font-semibold text-slate-900">{p.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      {p.code && <span className="font-mono">{p.code}</span>}
                      {p.custom && <Pill size="sm">Your own program</Pill>}
                      <span>{plural(counts.get(p.name.toLowerCase()) ?? 0, "intern")} in this course</span>
                    </p>
                  </div>
                  <FormField label="Required hours" error={problem} className="w-32 shrink-0">
                    <Input
                      inputMode="numeric"
                      maxLength={4}
                      value={p.hours}
                      onChange={(e) => setHours(p.name, e.target.value)}
                      aria-invalid={Boolean(problem)}
                      aria-label={`Required hours for ${p.name}`}
                    />
                  </FormField>
                  <button
                    type="button"
                    onClick={() => remove(p.name)}
                    aria-label={`Stop offering ${p.name}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 max-sm:h-[44px] max-sm:w-[44px]"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {droppedWithInterns.length > 0 && (
          <div className="k-note is-warn mt-3" role="status">
            <div className="min-w-0">
              {droppedWithInterns.map((o) => (
                <p key={o.name} className="break-words">
                  <strong>{o.name}</strong>: {plural(o.interns_count, "intern")} already {o.interns_count === 1 ? "has" : "have"} this course. They keep it, but it will no longer be offered for new interns.
                </p>
              ))}
            </div>
          </div>
        )}

        {leftovers.length > 0 && (
          <div className="mt-3">
            <p className="k-hint">Not offered, but interns still have these courses. Offer them again if your school still runs them.</p>
            <ul className="mt-1 divide-y divide-slate-200 rounded-xl border border-slate-200">
              {leftovers.map((u) => (
                <li key={u.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 basis-48 break-words text-sm text-slate-800">{u.name} <span className="text-xs text-slate-600">({plural(u.interns_count, "intern")})</span></span>
                  <Btn sm onClick={() => add(catalogByName.get(u.name.toLowerCase()) ?? { name: u.name, code: null, default_hours: limits.default_hours })}>
                    <Plus aria-hidden="true" size={14} /> Offer again
                  </Btn>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p role="alert" className="k-note is-risk mt-3">{error}</p>}
        {message && <p role="status" className="k-note is-ok mt-3">{message}</p>}

        <div className="mt-4 flex justify-end">
          <Btn variant="primary" onClick={save} disabled={busy || !dirty || hasHoursProblem} className="max-sm:w-full">
            {busy ? "Saving…" : dirty ? "Save courses" : "Saved"}
          </Btn>
        </div>
      </Section>

      <Section title="Add from the list" help="Tick every course your school offers. Then check its required hours above and save.">
        <div className="space-y-4">
          <SearchField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code (e.g. Nursing, BSED)" />

          {groups.length === 0 && <p className="text-sm text-slate-600">No course in the list matches &quot;{tidy(search)}&quot;. You can add it as your own program below.</p>}

          <div className="space-y-2">
            {groups.map((g, i) => {
              const chosen = g.courses.filter((c) => pickedKeys.has(c.name.toLowerCase())).length;
              return (
                <details key={`${g.label}-${searching}`} open={searching || openGroups.has(g.label) || (openGroups.size === 0 && i === 0)} className="group rounded-xl border border-slate-200">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                      <GraduationCap aria-hidden="true" size={16} className="shrink-0 text-slate-500" />
                      <span className="min-w-0 break-words">{g.label}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-600">{chosen} of {g.courses.length} picked</span>
                  </summary>
                  <ul className="k-list border-t border-slate-200">
                    {g.shown.map((c) => {
                      const on = pickedKeys.has(c.name.toLowerCase());
                      const internCount = counts.get(c.name.toLowerCase()) ?? 0;
                      return (
                        <li key={c.code} className={`px-3 py-1 ${on ? "bg-blue-50" : ""}`}>
                          <label className="k-check !items-center">
                            <input type="checkbox" checked={on} onChange={() => toggle(c)} className="accent-blue-600" />
                            <span className="min-w-0 flex-1 break-words">
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-2 font-mono text-xs text-slate-600">{c.code}</span>
                              {!on && internCount > 0 && <span className="ml-2 text-xs text-slate-600">{plural(internCount, "intern")} still in this course</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>

          <form onSubmit={addCustom}>
            <FormField label="Add a course not in the list" hint="Type the full name of your own program, for example Bachelor of Science in Hotel Operations.">
              <div className="flex gap-2">
                <Input
                  {...inputProps("courseName")}
                  value={custom}
                  onChange={(e) => setCustom(clean("courseName", e.target.value))}
                  maxLength={limits.max_name_length}
                  placeholder="Program name"
                  className="min-w-0 flex-1"
                />
                <Btn type="submit" className="shrink-0">Add</Btn>
              </div>
            </FormField>
          </form>
        </div>
      </Section>
    </Page>
  );
}
