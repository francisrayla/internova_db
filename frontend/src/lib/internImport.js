// Reading, cleaning and checking an intern masterlist (.xlsx or .csv) for
// the bulk import screen. Mirrors the backend's import checks
// (CoordinatorMonitoringController::internImportRowErrors) so most problems
// show up instantly; the server still re-checks everything, plus the ones
// only it can know (an email that already has an account).

import { clean } from "@/lib/inputRules";
import { YEAR_LEVEL_OPTIONS, normalizeYearLevel } from "@/lib/internOptions";
import { courseProblem } from "@/lib/schoolCourses";

export const IMPORT_MAX_ROWS = 200;
// No student number: each intern enters their own when they activate
// their account, so it never passes through the coordinator.
export const IMPORT_FIELDS = ["first_name", "last_name", "email", "course", "year_level"];

export const FIELD_LABELS = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  course: "Course",
  year_level: "Year level",
};

// The example row the template ships with — skipped on upload so a
// coordinator who forgets to delete it doesn't import a fake intern.
const SAMPLE_EMAIL = "juan.delacruz@school.edu.ph";

// Masterlists come from many places, so each column is recognized by any of
// the names schools commonly give it (compared lowercase, letters/digits only).
const HEADER_ALIASES = {
  first_name: ["firstname", "givenname", "first", "fname"],
  last_name: ["lastname", "surname", "familyname", "last", "lname"],
  full_name: ["name", "fullname", "studentname", "internname", "completename"],
  email: ["email", "emailaddress", "email1", "studentemail", "gmail", "eadd"],
  course: ["course", "program", "programcode", "degree", "coursecode"],
  year_level: ["yearlevel", "year", "yr", "level", "yearlvl"],
};

function headerKey(cell) {
  return String(cell ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(key)) map[field] = index;
    }
  });
  return map;
}

/** "Dela Cruz, Juan P." → last "Dela Cruz", first "Juan P.";
 *  "Juan Dela Cruz" → first "Juan Dela", last "Cruz" (best effort). */
function splitFullName(full) {
  const value = String(full ?? "").trim();
  if (value.includes(",")) {
    const [last, ...rest] = value.split(",");
    return { first: rest.join(" ").trim(), last: last.trim() };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: value, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Small CSV reader: quoted fields, escaped quotes, CRLF, a UTF-8 BOM, and
 *  the semicolon separator Excel uses in some regional settings. */
function parseCsv(text) {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Tidies one row the way each field's input rule would while typing. `canonical` turns "BSIT" into the full course name. */
export function cleanRow(row, canonical = (v) => String(v ?? "").trim()) {
  return {
    first_name: clean("personName", row.first_name ?? "").trim(),
    last_name: clean("personName", row.last_name ?? "").trim(),
    // Only spaces are dropped from a file's email: a stray character is flagged for fixing, never silently removed
    // (removing it could turn a wrong address into someone else's).
    email: String(row.email ?? "").replace(/\s/g, "").slice(0, 100).toLowerCase(),
    course: canonical(row.course).slice(0, 150),
    year_level: normalizeYearLevel(row.year_level),
  };
}

let nextKey = 1;

/**
 * Reads an uploaded file into clean rows. Throws an Error with a
 * coordinator-friendly message when the file can't be used at all.
 */
export async function readInternFile(file, canonical) {
  const name = file.name.toLowerCase();
  let table;
  if (name.endsWith(".csv")) {
    table = parseCsv(await file.text());
  } else if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    try {
      table = await readSheet(file);
    } catch {
      throw new Error("This Excel file couldn't be opened. Save it again as .xlsx (or .csv) and try once more.");
    }
  } else if (name.endsWith(".xls")) {
    throw new Error("Old .xls files aren't supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
  } else {
    throw new Error("Upload an Excel (.xlsx) or CSV (.csv) file.");
  }

  // The header is the first row that names at least two known columns —
  // masterlists often have a title or school name in the first few rows.
  const headerIndex = table.findIndex((r) => Object.keys(mapHeaders(r)).length >= 2);
  if (headerIndex === -1) {
    throw new Error("We couldn't find the column headings. Use the template, or make sure your first row has First name, Last name and Email.");
  }
  const columns = mapHeaders(table[headerIndex]);
  const hasNames = (columns.first_name !== undefined && columns.last_name !== undefined) || columns.full_name !== undefined;
  if (!hasNames || columns.email === undefined) {
    throw new Error("Your file needs First name, Last name (or a single Name column) and Email columns.");
  }

  let skippedSample = false;
  const rows = [];
  for (const raw of table.slice(headerIndex + 1)) {
    const get = (field) => (columns[field] === undefined ? "" : cellText(raw[columns[field]]));
    if (IMPORT_FIELDS.every((f) => get(f) === "") && get("full_name") === "") continue;

    let first = get("first_name");
    let last = get("last_name");
    if ((!first || !last) && get("full_name")) {
      const split = splitFullName(get("full_name"));
      first = first || split.first;
      last = last || split.last;
    }
    const row = cleanRow({ first_name: first, last_name: last, email: get("email"), course: get("course"), year_level: get("year_level") }, canonical);
    if (row.email === SAMPLE_EMAIL) { skippedSample = true; continue; }
    rows.push({ key: nextKey++, ...row });
  }

  if (rows.length === 0) throw new Error("The file has headings but no interns under them yet.");
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new Error(`This file lists ${rows.length} interns. Import up to ${IMPORT_MAX_ROWS} at a time — split the list into two files.`);
  }
  return { rows, skippedSample };
}

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

/** Format and in-file duplicate checks: { [rowKey]: { field: message } }. `offered` = the school's courses (API list). */
export function validateRows(rows, offered = [], canonical = (v) => String(v ?? "").trim()) {
  const count = (field) => rows.reduce((m, r) => (r[field] ? m.set(r[field], (m.get(r[field]) ?? 0) + 1) : m), new Map());
  const emailCounts = count("email");
  const errors = {};

  for (const row of rows) {
    const e = {};
    for (const field of ["first_name", "last_name"]) {
      if (!row[field]) e[field] = `${FIELD_LABELS[field]} is required.`;
      else if (!NAME_PATTERN.test(row[field])) e[field] = "Letters, spaces, periods, apostrophes and hyphens only.";
    }
    if (!row.email) e.email = "Email is required.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) e.email = "Enter a valid email address.";
    else if (emailCounts.get(row.email) > 1) e.email = "Listed more than once in this file.";
    if (!row.course) e.course = "Course is required.";
    else if (courseProblem(offered, canonical, row.course)) e.course = courseProblem(offered, canonical, row.course);
    if (!YEAR_LEVEL_OPTIONS.includes(row.year_level)) e.year_level = "Use 4th Year or 5th Year.";
    if (Object.keys(e).length) errors[row.key] = e;
  }
  return errors;
}

/** Downloads the ready-to-fill template: an "Interns" sheet with headings
 *  and one example row, and a "How to fill" sheet explaining each column. */
export async function downloadTemplate(offered = []) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const head = (value) => ({ value, fontWeight: "bold", backgroundColor: "#DBEAFE" });
  const example = (value) => ({ value, textColor: "#64748B" });

  const interns = [
    IMPORT_FIELDS.map((f) => head(FIELD_LABELS[f])),
    [example("Juan"), example("Dela Cruz"), example(SAMPLE_EMAIL), example(offered[0]?.code ?? offered[0]?.name ?? "BSIT"), example("4th Year")],
  ];
  const guide = [
    [head("Column"), head("Required?"), head("What to put")],
    ["First name", "Required", "Letters only, up to 50 characters."],
    ["Last name", "Required", "Letters only, up to 50 characters."],
    ["Email", "Required", "Where the intern receives the link to set their password. One per intern."],
    ["Course", "Required", offered.length
      ? "Only a course your school offers (see the list below). The code or the full name both work; the full name is what gets saved."
      : "Your school has not set up its courses yet. Set them in Settings, Courses offered, before importing."],
    ["Year level", "Optional", "4th Year or 5th Year. Leave blank for 4th Year."],
    [],
    ["The grey example row in the Interns sheet is skipped automatically — you can type over it or leave it."],
    [`Up to ${IMPORT_MAX_ROWS} interns per file.`],
    ["Student numbers are not needed — each intern enters their own when they activate their account."],
    ...(offered.length ? [[], [head("Courses offered"), "", head("Code or full name")], ...offered.map((c) => ["", "", c.code ? `${c.code} - ${c.name}` : c.name])] : []),
  ];

  await writeExcelFile([
    { data: interns, sheet: "Interns", stickyRowsCount: 1, columns: [{ width: 18 }, { width: 18 }, { width: 34 }, { width: 14 }, { width: 12 }] },
    { data: guide, sheet: "How to fill", columns: [{ width: 16 }, { width: 12 }, { width: 70 }] },
  ]).toFile("Internova - Intern import template.xlsx");
}
