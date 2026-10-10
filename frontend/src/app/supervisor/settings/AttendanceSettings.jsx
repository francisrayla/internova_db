"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import NavIcon from "@/components/NavIcon";
import { Banner } from "@/components/ui";
import { Btn, Page, PageHeader } from "@/components/dash/page";

const OPTIONS = [
  {
    value: "single",
    title: "One time in and one time out",
    entries: "2 entries a day",
    text: "Interns time in once when they arrive and time out once when they leave. Best when interns work straight through the day.",
    example: [["Time in", "8:00 AM"], ["Time out", "5:00 PM"]],
  },
  {
    value: "split",
    title: "Morning and afternoon",
    entries: "4 entries a day",
    text: "Interns time in and out in the morning, then again in the afternoon, so the lunch break is not counted.",
    example: [["Morning in", "8:00 AM"], ["Morning out", "12:00 PM"], ["Afternoon in", "1:00 PM"], ["Afternoon out", "5:00 PM"]],
  },
];

export default function AttendanceSettings() {
  const [company, setCompany] = useState(null);
  const [saved, setSaved] = useState(null); // what the server has
  const [choice, setChoice] = useState(null); // what is selected on screen
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchSupervisorData("attendance-settings")
      .then((r) => {
        setCompany(r.company);
        setSaved(r.attendance_mode);
        setChoice(r.attendance_mode);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/supervisor/attendance-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_mode: choice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the setting. Please try again.");
      setSaved(data.attendance_mode);
      setNotice("Saved. The interns of your company were told about the new format.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const changed = choice !== saved;

  return (
    <Page>
      <PageHeader
        title="Attendance format"
        sentence={<>Choose how the interns of {company ? <strong className="font-semibold text-slate-800">{company.name}</strong> : "your company"} record attendance.</>}
      />

      {error && <Banner tone="red">{error}</Banner>}
      {notice && <Banner tone="green">{notice}</Banner>}

      {loading ? (
        <p className="dash-card text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Attendance format" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {OPTIONS.map((o) => {
              const on = choice === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChoice(o.value)}
                  className={`flex min-w-0 flex-col justify-start rounded-3xl border p-5 text-left transition ${on ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-base font-semibold text-slate-900">{o.title}</p>
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-blue-600 bg-blue-600" : "border-slate-300"}`}>
                      {on && <span className="h-2 w-2 rounded-full bg-white" />}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-blue-700">{o.entries}</p>
                  <p className="mt-2 text-sm text-slate-600">{o.text}</p>
                  <ul className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                    {o.example.map(([label, time]) => (
                      <li key={label} className="flex justify-between gap-3 text-slate-700">
                        <span>{label}</span>
                        <span className="font-semibold text-slate-900">{time}</span>
                      </li>
                    ))}
                  </ul>
                  {saved === o.value && (
                    <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <NavIcon name="check" size={14} /> Currently used
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="dash-note">
            This applies to every intern of {company?.name ?? "your company"} and to all of its supervisors. A day that already started keeps the format it began
            with, so nobody is stopped halfway.
          </div>

          <div className="flex justify-end">
            <Btn variant="primary" onClick={save} disabled={!changed || saving} className="max-sm:w-full">
              {saving ? "Saving…" : "Save setting"}
            </Btn>
          </div>
        </>
      )}
    </Page>
  );
}
