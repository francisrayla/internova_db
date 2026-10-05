# Feature logs index

One line per feature: `- <slug> — <summary> — last: <commit> (<date>)`

- attendance — Intern clock in/out (selfie+GPS), offline queue/weak-connection sync, offline landing on Attendance, supervisor log/review, coordinator view — last: cef02dc (2026-10-05)
- activities — Intern narrative entries, supervisor review and approve-all, approved/recorded-only narrative report — last: d4b17ed (2026-10-05)
- tasks — Tasks across intern/supervisor/coordinator: group tasks, subtasks, comments, proofs, supervisor 1-10 ratings (TaskRatingAverage) — last: cef02dc (2026-10-05)
- evaluations — Formal OJT evaluations: school criteria (DefaultEvaluationCriteria), supervisor scoring with task-rating suggested scores, manual evaluation, intern/coordinator views — last: cef02dc (2026-10-05)
- auth — Login, signup email verification (Spam hint/resend), password reset, invitations, bounce webhook, EmailDeliverability, role middleware — last: 1b9390d + uncommitted (2026-10-05)
- notifications — NotificationService + Reverb broadcast (public channels), bell/history for all roles, useLiveRefresh — last: 1b9390d + uncommitted (2026-10-05)
- documents-portfolio — Documents + review, portfolio, school-pattern narrative report (NarrativeTemplate, NarrativeReportService, print layout, Word .docx export NarrativeDocxService), /api/download proxy, Gemini polish, DeploymentSummaryService — last: 43bc039 + uncommitted (2026-10-05)
- coordinator-monitoring — Coordinator dashboard/interns/companies/supervisors/settings/pending/preview and supervisor dashboard/interns/profile; scoped controllers, deployment models, policy stubs — last: 1b9390d + uncommitted (2026-10-05)
- subscription-billing — Dean offer/PayMongo/proof payment, upgrades and plan changes, superadmin plans and billing, PlanFeatures inline gating — last: 1b9390d + uncommitted (2026-10-05)
- superadmin — Schools, inquiries, support tickets, activity logs, AI usage, system settings and maintenance mode (SuperadminFullController) — last: 1b9390d + uncommitted (2026-10-05)
- dean — Dean/Principal role: account owner (billing, settings, invites coordinator) + read-only monitoring (overview alerts, coordinator activity/pending/feedback, interns list/detail/narrative report), coordinator Dean Feedback page — last: 1b9390d + uncommitted (2026-10-05)
