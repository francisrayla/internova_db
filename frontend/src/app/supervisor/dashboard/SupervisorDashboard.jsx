"use client";

import { useEffect, useState } from "react";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { greeting } from "@/lib/timeAgo";
import { plural } from "@/lib/format";
import { Card, Cols, DashHeader, DashPage, Notice, PersonRow, Skel, StatStrip, TextLink } from "@/components/dash";

/** What a supervisor can act on: finished, or hours waiting for review. */
function internChip(i) {
  if (i.display_status === "completed") return { tone: "ok", label: "Finished" };
  if (i.pending_attendance > 0) return { tone: "warn", label: `${i.pending_attendance} to review` };
  return null;
}

export default function SupervisorDashboard() {
  const [interns, setInterns] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState(false);
  const [reloads, setReloads] = useState(0);

  // A failed load shows a message with "Try again" (never a row of zeros that looks like real numbers).
  function retry() {
    setError(false);
    setLoading(true);
    setReloads((n) => n + 1);
  }

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("internova_user") || "null");
      if (stored?.name) setName(stored.name.split(" ")[0]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchSupervisorData("interns"),
      // The figures come from the server so they use the same definitions as the Interns page.
      fetchSupervisorData("dashboard"),
    ])
      .then(([internsRes, dashboardRes]) => {
        if (!live) return;
        setInterns(internsRes.interns ?? []);
        setDashboard(dashboardRes);
      })
      .catch(() => live && setError(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloads]);

  const summary = dashboard?.summary;
  const redFlags = summary?.red_flags_unchecked ?? 0;
  const company = interns[0]?.company_name ?? "your company";
  const roster = interns.filter((i) => !["inactive", "invitation_pending"].includes(i.display_status));

  const figures = [
    { label: "Interns", value: summary?.on_list ?? 0, note: `${summary?.active ?? 0} active`, href: "/supervisor/interns" },
    { label: "Completed", value: summary?.completed ?? 0, note: (summary?.completed ?? 0) > 0 ? "Finished their hours" : "None yet", href: "/supervisor/interns" },
    { label: "Average hours", value: `${summary?.average_hours_pct ?? 0}%`, note: "Across your company", href: "/supervisor/interns" },
  ];

  return (
    <DashPage>
      <DashHeader title={`${greeting()}${name ? `, ${name}` : ""}`} sentence={`Here's how the interns at ${company} are doing today.`}>
        <TextLink href="/supervisor/interns" arrow>View interns</TextLink>
        <TextLink href="/supervisor/attendance" arrow>Attendance</TextLink>
      </DashHeader>

      {error && <Notice onRetry={retry}>We couldn&apos;t load your dashboard. Check your connection and try again.</Notice>}

      {!error && (loading ? <Skel height={104} /> : <StatStrip items={figures} />)}

      {!error && <Cols layout="wide-left">
        <Card title="Your interns" help="Hours rendered out of the hours required." action={<TextLink href="/supervisor/interns" arrow>View all</TextLink>}>
          {loading ? (
            <p className="dash-empty">Loading…</p>
          ) : roster.length === 0 ? (
            <p className="dash-empty">No interns are deployed at your company yet.</p>
          ) : (
            <ul className="dash-list">
              {roster.slice(0, 6).map((i) => (
                <li key={i.deployment_id}>
                  <PersonRow
                    name={i.intern_name}
                    sub={i.course ? `${i.course}${i.year_level ? ` · ${i.year_level}` : ""}` : (i.company_name ?? "")}
                    pct={i.hours_progress_pct}
                    tone={i.display_status === "completed" ? "ok" : undefined}
                    chip={internChip(i)}
                    href={`/supervisor/interns/${i.deployment_id}/portfolio`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Red flags to check" className="is-aside">
          {loading ? (
            <p className="dash-empty">Loading…</p>
          ) : (
            <>
              <p className={`dash-big${redFlags > 0 ? " is-risk" : ""}`}>{redFlags}</p>
              <p className="dash-note" style={{ marginTop: 10 }}>
                {redFlags > 0
                  ? `${plural(redFlags, "clock-in")} ${redFlags === 1 ? "looks" : "look"} unusual and ${redFlags === 1 ? "hasn't" : "haven't"} been checked yet.`
                  : "Nothing to check. Every odd clock-in has been looked at."}
              </p>
              {redFlags > 0 && (
                <div style={{ marginTop: 14 }}>
                  <TextLink href="/supervisor/attendance?flag=unchecked" arrow>Check them</TextLink>
                </div>
              )}
            </>
          )}
        </Card>
      </Cols>}
    </DashPage>
  );
}
