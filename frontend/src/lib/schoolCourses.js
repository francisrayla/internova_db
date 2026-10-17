"use client";

// The courses a school offers (Settings -> Courses offered) and the catalog behind them. There is NO copy of the
// catalog in the frontend: it comes from GET /api/coordinator/school-courses (App\Support\Courses on the server),
// so the two can never drift. This file only reads that answer and mirrors the server's matching rules, so
// the Add intern form and the Excel import can tell a coordinator about a wrong course before the server does.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchApiData } from "@/lib/apiFetch";

export const COURSE_NOT_OFFERED = "This course isn't offered by your school. Add it in Settings → Courses offered.";
export const COURSE_NONE_YET = "Your school hasn't set up its courses yet. Set them in Settings → Courses offered first.";
export const DEFAULT_COURSE_HOURS = 500;

const codeKey = (value) => String(value ?? "").toUpperCase().replace(/[\s.-]/g, "");
const tidy = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Same matching as App\Support\Courses::canonical(): codes, aliases ("BIT"), "BS …" long forms and full names, any case. */
export function makeCourseResolver(catalog) {
  const byCode = new Map();
  const byName = new Map();
  for (const group of catalog ?? []) {
    for (const c of group.courses) {
      byCode.set(codeKey(c.code), c.name);
      byName.set(c.name.toLowerCase(), c.name);
    }
  }
  for (const group of catalog ?? []) {
    for (const c of group.courses) for (const alias of c.aliases ?? []) if (!byCode.has(codeKey(alias))) byCode.set(codeKey(alias), c.name);
  }

  return function canonical(value) {
    const text = tidy(value);
    if (!text) return "";
    const byShortCode = byCode.get(codeKey(text));
    if (byShortCode) return byShortCode;
    const lower = text.toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
    if (byName.has(lower)) return byName.get(lower);
    for (const [pattern, prefix] of [[/^b\s*s\s+(in\s+)?/, "bachelor of science in "], [/^(a\s*b|b\s*a)\s+(in\s+)?/, "bachelor of arts in "]]) {
      const long = lower.replace(pattern, prefix).replace(/\s+/g, " ").trim();
      if (long !== lower && byName.has(long)) return byName.get(long);
    }
    return text;
  };
}

/** Why a course can't be given to a new intern (null = fine). `offered` is the API's offered list. */
export function courseProblem(offered, canonical, value) {
  if (!offered?.length) return COURSE_NONE_YET;
  const name = canonical(value);
  if (!name || !offered.some((c) => c.name.toLowerCase() === name.toLowerCase())) return COURSE_NOT_OFFERED;
  return null;
}

/** Required hours of a new intern in that course: the school's figure, else the catalog default. */
export function hoursForOffered(offered, canonical, value) {
  const name = canonical(value).toLowerCase();
  return offered?.find((c) => c.name.toLowerCase() === name)?.hours ?? DEFAULT_COURSE_HOURS;
}

/**
 * Loads the school's courses for a coordinator screen (Add intern, Import).
 * { loading, error, offered, catalog, canonical, reload } — `offered` is [] until loaded.
 */
export function useSchoolCourses(prefix = "coordinator") {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchApiData(prefix, "school-courses")
      .then((d) => { if (alive) { setData(d); setError(""); } })
      .catch((err) => { if (alive) setError(err.message || "Could not load your school's courses."); });
    return () => { alive = false; };
  }, [prefix, tick]);

  const canonical = useMemo(() => makeCourseResolver(data?.catalog), [data]);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  return { loading: data === null && !error, error, offered: data?.offered ?? [], catalog: data?.catalog ?? [], canonical, reload };
}
