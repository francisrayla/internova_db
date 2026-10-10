"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";
import { greeting } from "@/lib/timeAgo";
import { Card, Col, Cols, DashHeader, DashPage, Notice, PersonRow, Skel, StatStrip, TextLink } from "@/components/dash";

/** The one thing worth saying about an intern in a list: finished, behind, or not clocking in. */
function internChip(i) {
  if (i.display_status === "completed") return { tone: "ok", label: "Finished" };
  const keys = (i.attention ?? []).map((a) => a.key);
  if (keys.includes("no_clock_in")) return { tone: "risk", label: "Not clocking in" };
  if (keys.includes("behind_hours")) return { tone: "warn", label: "Behind" };
  if (keys.length > 0) return { tone: "warn", label: "Needs a look" };
  return null;
}

export default function CoordinatorDashboard() {
  const [interns, setInterns] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [pendingDocuments, setPendingDocuments] = useState([]);
  const [pendingDocumentsTotal, setPendingDocumentsTotal] = useState(0);
  const [evaluations, setEvaluations] = useState([]);
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
      fetchCoordinatorData("interns"),
      // Only the totals are needed here, not every task.
      fetchCoordinatorData("tasks?view=summary"),
      // Only the newest few rows are shown; the count comes from `total`.
      fetchCoordinatorData("documents?status=pending&per_page=5"),
      fetchCoordinatorData("evaluations?per_page=4"),
      // The figures come from the server so they use the same definitions as the Interns page.
      fetchCoordinatorData("dashboard").catch(() => null),
    ])
      .then(([internsRes, tasksRes, documentsRes, evalRes, dashboardRes]) => {
        if (!live) return;
        setDashboard(dashboardRes);
        setInterns(internsRes.interns ?? []);
        setTasks(tasksRes.companies ?? []);
        setPendingDocuments(documentsRes.documents ?? []);
        setPendingDocumentsTotal(documentsRes.total ?? (documentsRes.documents ?? []).length);
        setEvaluations(evalRes.evaluations ?? []);
      })
      .catch(() => live && setError(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloads]);

  // "Completed" = finished their required hours (or marked completed); "active" = still working with an account.
  const summary = dashboard?.summary;
  const activeCount = summary?.active ?? interns.filter((i) => i.display_status === "active").length;
  const completedCount = summary?.completed ?? interns.filter((i) => i.display_status === "completed").length;
  const onList = summary?.on_list ?? activeCount + completedCount;
  const avgHoursProgress = summary?.average_hours_pct ?? 0;

  // Same list as the Interns page: archived interns and pending accounts are not part of it.
  const rosterInterns = interns.filter((i) => !["inactive", "invitation_pending"].includes(i.display_status));

  const tasksTotal = tasks.reduce((n, c) => n + (c.total ?? 0), 0);
  const tasksDone = tasks.reduce((n, c) => n + (c.completed ?? 0), 0);
  const taskCompletionPct = tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const docs = pendingDocumentsTotal;

  const figures = [
    { label: "Interns", value: onList, note: `${activeCount} active`, href: "/coordinator/interns" },
    { label: "Completed", value: completedCount, note: completedCount > 0 ? "Finished their hours" : "None yet", href: "/coordinator/interns?filter=completed" },
    { label: "Average hours", value: `${avgHoursProgress}%`, note: "Across your list", href: "/coordinator/interns" },
    { label: "Task completion", value: `${taskCompletionPct}%`, note: `${tasksDone} of ${tasksTotal} tasks done`, href: "/coordinator/tasks" },
    { label: "Documents to review", value: docs, note: docs > 0 ? "Waiting for you" : "All caught up", href: "/coordinator/documents", tone: docs > 0 ? "warn" : undefined },
  ];

  return (
    <DashPage>
      <DashHeader title={`${greeting()}${name ? `, ${name}` : ""}`} sentence="Here's how your interns and their work are doing today.">
        <TextLink href="/coordinator/interns" arrow>View interns</TextLink>
        <TextLink href="/coordinator/tasks" arrow>View tasks</TextLink>
      </DashHeader>

      {error && <Notice onRetry={retry}>We couldn&apos;t load your dashboard. Check your connection and try again.</Notice>}

      {!error && (loading ? <Skel height={104} /> : <StatStrip items={figures} />)}

      {!error && <Cols layout="wide-left">
        <Card title="Intern progress" help="Hours rendered out of the hours required." action={<TextLink href="/coordinator/interns" arrow>View all</TextLink>}>
          {loading ? (
            <p className="dash-empty">Loading…</p>
          ) : rosterInterns.length === 0 ? (
            <p className="dash-empty">No interns have been deployed yet.</p>
          ) : (
            <ul className="dash-list">
              {rosterInterns.slice(0, 6).map((i) => (
                <li key={i.deployment_id}>
                  <PersonRow
                    name={i.intern_name}
                    sub={i.company_name ?? "No company yet"}
                    pct={i.hours_progress_pct}
                    tone={i.display_status === "completed" ? "ok" : undefined}
                    chip={internChip(i)}
                    href="/coordinator/interns"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Col>
          <Card title="Documents to review" action={docs > 0 ? <TextLink href="/coordinator/documents" arrow>Review</TextLink> : null}>
            {loading ? (
              <p className="dash-empty">Loading…</p>
            ) : docs === 0 ? (
              <p className="dash-empty">Nothing is waiting. You&apos;re all caught up.</p>
            ) : (
              <ul className="dash-list">
                {pendingDocuments.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    <Link href="/coordinator/documents" className="dash-row">
                      <span className="dash-row-main">
                        <span className="dash-row-title">{d.intern_name}</span>
                        <span className="dash-row-sub">{d.document_type}</span>
                      </span>
                      <span className="dash-row-side">{d.uploaded_at}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent evaluations" action={<TextLink href="/coordinator/evaluations" arrow>View all</TextLink>}>
            {loading ? (
              <p className="dash-empty">Loading…</p>
            ) : evaluations.length === 0 ? (
              <p className="dash-empty">No evaluations submitted yet.</p>
            ) : (
              <ul className="dash-list">
                {evaluations.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <div className="dash-row">
                      <span className="dash-row-main">
                        <span className="dash-row-title">{e.intern_name}</span>
                        <span className="dash-row-sub">Evaluation · {e.evaluation_date}</span>
                      </span>
                      {e.overall_score != null && <span className="dash-row-pct">{Number(e.overall_score)}%</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Col>
      </Cols>}
    </DashPage>
  );
}
