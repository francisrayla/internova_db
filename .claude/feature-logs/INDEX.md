# Feature logs index

One line per feature: `- <slug> — <summary> — last: <commit> (<date>)`

- attendance — Intern clock in/out (selfie+GPS), offline queue/weak-connection sync, offline landing on Attendance, supervisor log/review, coordinator view — last: 5a24cfb + uncommitted (2026-10-06)
- activities — Intern narrative entries, supervisor review and approve-all, approved/recorded-only narrative report — last: 5a24cfb + uncommitted (2026-10-06)
- tasks — Tasks across intern/supervisor/coordinator: group tasks, subtasks, comments, proofs, supervisor 1-10 ratings (TaskRatingAverage) — last: 5a24cfb + uncommitted (2026-10-06)
- evaluations — Formal OJT evaluations: school criteria (DefaultEvaluationCriteria), supervisor scoring with task-rating suggested scores, manual evaluation, intern/coordinator views — last: 5a24cfb+uncommitted (2026-10-06)
- auth — Login, signup email verification (Spam hint/resend), password reset, invitations, bounce webhook, EmailDeliverability, role middleware — last: 1b9390d + uncommitted (2026-10-05)
- notifications — NotificationService + Reverb broadcast (public channels), bell/history for all roles, useLiveRefresh — last: 5a24cfb + uncommitted (2026-10-06)
- documents-portfolio — Documents + review, portfolio, school-pattern narrative report (NarrativeTemplate, NarrativeReportService, print layout, Word .docx export NarrativeDocxService), /api/download proxy, Gemini polish, DeploymentSummaryService — last: 5a24cfb + uncommitted (2026-10-06)
- coordinator-monitoring — Coordinator dashboard/interns/companies/supervisors/settings/pending/preview and supervisor dashboard/interns/profile; scoped controllers, deployment models, policy stubs; supervisors are per company (scopeVisibleToSupervisor); reassign = in-place transfer with deployment_transfers history + merge backfill — last: 5a24cfb + uncommitted (2026-10-06)
- subscription-billing — Dean/superadmin billing: PayMongo/bank checkout, price breakdown helper, scheduled plan switches, revenue report, plans:dedupe, approved changes await payment (waived 0), monthly->yearly with credit — last: a0e19d5+uncommitted (2026-10-06)
- superadmin — superadmin dashboard (server-side revenue), schools, settings, AI usage, logs, inquiries, support, maintenance — last: 5a24cfb+uncommitted (2026-10-06)
- dean — Dean/Principal role: billing/settings + read-only monitoring: status groups, projected finish, attendance calendar, table view, coordinator scorecard/setup/activity chart, two-way feedback threads, weekly summary email (dean:weekly-summary), school .docx report — last: 5a24cfb + uncommitted (2026-10-06)
