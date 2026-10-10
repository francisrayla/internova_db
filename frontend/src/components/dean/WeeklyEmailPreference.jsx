"use client";

import { useEffect, useState } from "react";
import { apiFetch, fetchApiData } from "@/lib/apiFetch";

/** Dean's on/off switch for the Monday weekly summary email. */
export default function WeeklyEmailPreference() {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    fetchApiData("dean", "preferences")
      .then((d) => {
        if (!live) return;
        setEnabled(Boolean(d.weekly_summary_email));
        setError("");
      })
      .catch(() => live && setError("We couldn't load this setting."));
    return () => {
      live = false;
    };
  }, [reloads]);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/dean/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ weekly_summary_email: next }),
      });
      if (!res.ok) throw new Error("failed");
      setEnabled(next);
    } catch {
      setError("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Weekly summary email</h2>
          <p className="mt-1 text-sm text-slate-600">Every Monday at 7:00 AM (Philippine time) we email you how last week went: intern status groups, hours rendered, coordinator activity and links to your Dean pages.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(enabled)}
          aria-label="Weekly summary email"
          disabled={enabled === null || busy}
          onClick={toggle}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition before:absolute before:-inset-2.5 before:content-[''] disabled:opacity-60 ${enabled ? "bg-blue-600" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {error && (
        <p className="k-note is-risk mt-3" role="alert">
          <span>{error}</span>
          {enabled === null && <button type="button" onClick={() => setReloads((n) => n + 1)}>Try again</button>}
        </p>
      )}
    </section>
  );
}
