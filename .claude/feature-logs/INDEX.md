# Feature logs index

One line per feature: `- <slug> — <summary> — last: <commit> (<date>)`

- attendance — Intern clock in/out (selfie+GPS), offline queue/weak-connection sync, offline landing on Attendance, supervisor log/review, coordinator view — last: cef02dc (2026-10-05)
- activities — Intern narrative entries, supervisor review and approve-all, approved/recorded-only narrative report — last: d4b17ed (2026-10-05)
- tasks — Tasks across intern/supervisor/coordinator: group tasks, subtasks, comments, proofs, supervisor 1-10 ratings (TaskRatingAverage) — last: cef02dc (2026-10-05)
- evaluations — Formal OJT evaluations: school criteria (DefaultEvaluationCriteria), supervisor scoring with task-rating suggested scores, manual evaluation, intern/coordinator views — last: cef02dc (2026-10-05)
- auth — Login, signup email verification (Spam hint/resend), password reset, invitations, bounce webhook, EmailDeliverability, role middleware — last: cef02dc (2026-10-05)
- notifications — NotificationService + Reverb broadcast (public channels), bell/history for all roles, useLiveRefresh — last: cef02dc (2026-10-05)
- documents-portfolio — Intern/coordinator documents + review, intern portfolio, printable reports, /api/download proxy, Gemini narrative polish (NarrativeAiService), DeploymentSummaryService — last: cef02dc (2026-10-05)
- coordinator-monitoring — Coordinator dashboard/interns/companies/supervisors/settings/pending/preview and supervisor dashboard/interns/profile; scoped controllers, deployment models, policy stubs — last: cef02dc (2026-10-05)
- subscription-billing — Coordinator offer/PayMongo/proof payment, upgrades and plan changes, superadmin plans and billing, PlanFeatures inline gating — last: cef02dc (2026-10-05)
- superadmin — Schools, inquiries, support tickets, activity logs, AI usage, system settings and maintenance mode (SuperadminFullController) — last: cef02dc (2026-10-05)
