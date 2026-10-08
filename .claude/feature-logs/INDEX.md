# Feature logs index

One line per feature: `- <slug> — <summary> — last: <commit> (<date>)`

- attendance — Intern clock in/out (selfie+GPS), offline queue/weak-connection sync, offline landing on Attendance, supervisor log/review, coordinator view — last: 6bc841a (2026-10-06)
- activities — Intern narrative entries, supervisor review and approve-all, approved/recorded-only narrative report — last: 6bc841a (2026-10-06)
- tasks — Tasks across intern/supervisor/coordinator: group tasks, subtasks (drag + dropdown), parent-needs-subtasks rule, supervisor edit, History only after rating, Manila due badge, comments, proofs, 1-10 ratings — last: a7a1ff7 + uncommitted (2026-10-08)
- evaluations — Formal OJT evaluations: school criteria (DefaultEvaluationCriteria), supervisor scoring with task-rating suggested scores, manual evaluation, intern/coordinator views — last: 6bc841a (2026-10-06)
- auth — Login, signup email verification (Spam hint/resend), password reset, invitations, bounce webhook, EmailDeliverability, role middleware — last: 6bc841a (2026-10-06)
- notifications — NotificationService + Reverb broadcast (public channels), bell/history for all roles, useLiveRefresh — last: 6bc841a (2026-10-06)
- documents-portfolio — Documents + review, portfolio, school-pattern narrative report (NarrativeTemplate, NarrativeReportService, print layout, Word .docx export NarrativeDocxService), /api/download proxy, Gemini polish, DeploymentSummaryService — last: 6bc841a (2026-10-06)
- coordinator-monitoring — Coordinator dashboard/interns/companies/supervisors/settings/pending/preview and supervisor dashboard/interns/profile; scoped controllers, deployment models, policy stubs; supervisors are per company (scopeVisibleToSupervisor); reassign = in-place transfer with deployment_transfers history + merge backfill — last: 6bc841a (2026-10-06)
- subscription-billing — Dean/superadmin billing: PayMongo/bank checkout, price breakdown helper, scheduled plan switches, revenue report, plans:dedupe, approved changes await payment (waived 0), monthly->yearly with credit — last: 6bc841a (2026-10-06)
- superadmin — superadmin dashboard (server-side revenue), schools, settings, AI usage, logs, inquiries, support, maintenance — last: 6bc841a (2026-10-06)
- dean — Dean/Principal role: billing/settings + read-only monitoring: status groups, projected finish, attendance calendar, table view, coordinator scorecard/setup/activity chart, two-way feedback threads, weekly summary email (dean:weekly-summary), school .docx report — last: 6bc841a (2026-10-06)
- settings — one Settings hub per role (account, appearance, school info, notifications, narrative layout, supervisor attendance format, system) — last: 6bc841a (2026-10-07)
- certificates — supervisor uploads one PowerPoint certificate template per company, picks an intern and downloads the filled-in .pptx ({{NAME}} etc.) — last: 6bc841a (2026-10-07)
