# Activities (intern narrative entries / supervisor approval)
last_commit: 5a24cfb + uncommitted
updated: 2026-10-06

## Map (where the code lives)
- frontend/src/app/intern/activities/DailyActivities.jsx (494) — intern writes/edits entries, suggestions, polish narrative; shows status (edits to recorded -> pending). page.jsx wrapper.
- frontend/src/app/supervisor/activities/InternActivities.jsx (159) — review list, status filter, approveAll() (~L35-48, POST /api/supervisor/activities/approve, confirm dialog, "Approve all pending" button ~L98), per-entry approve/reject.
- frontend/src/app/intern/portfolio/report/PortfolioReport.jsx — printable narrative report; only approved+recorded entries included, pending listed as waiting, rejected omitted.
- Proxies: frontend/src/app/api/{intern,supervisor}/[...path]/route.js.
- backend/routes/api.php — intern L243-247 (GET activities, GET activities/suggestions, POST activities/polish-narrative, POST activities, PATCH activities/{id}); supervisor L197-199 (GET activities, POST activities/approve, PATCH activities/{id}).
- InternMonitoringController.php — activities L788, activitySuggestions L812, polishNarrative L855, storeActivity L875, updateActivity L937.
- SupervisorMonitoringController.php — activities L810, reviewActivity L842, approveActivities L897 (batch, one notification per intern).
- backend/app/Models/DailyActivity.php — statuses PENDING/APPROVED/REJECTED/RECORDED; IN_REPORT=[approved,recorded]; EDITABLE=[pending,recorded]; relations deployment, sourceTask, sourceSubtask.
- backend/app/Jobs/GenerateNarrativeForAttendance.php — creates auto-generated summary (status recorded).
- DB: daily_activities (create L258 of 2026_08_11_000001 migration) + photo_path (08_17), source_task/subtask (08_22), drop hours_rendered (08_22_02), is_auto_generated (09_22), mark_auto_generated_activities_recorded (2026_10_04).

- Supervisor activities list/review/approve-all use visibleToSupervisor (either supervisor can approve; reviewed_by keeps who did). (see coordinator-monitoring log for the shared rule)

## How it works
Intern posts entries (pending). Auto summaries from attendance are "recorded" (no sign-off); if intern edits one it becomes pending. Supervisor can only decide pending entries: approve/reject with remarks, or approve all pending in one call. Only approved/recorded flow into the narrative report (commit cef02dc).

## How to test
- No activity tests in backend/tests/Feature (only InternovaApiTest, InternovaSeederTest, SuperadminApiTest, ExampleTest; SuperadminApiTest's "activity" is activity logs). `cd backend && php artisan migrate && php artisan test`.
- `php artisan test --filter=Activit` finds 0 tests (no activity tests yet). The full suite runs on MySQL `internova_testing` (guarded in `tests/TestCase.php`) and passes 8/8. Use the manual flow below.
- Manual: intern adds entry -> supervisor sees pending -> approve all -> intern gets notification, report includes it; edit a recorded summary -> becomes pending; reject -> omitted from report.

## History (newest first, keep only the last 5)
- 2026-10-06 5a24cfb + uncommitted — activity_date default + suggestions (completed_at) use the Manila day (LocalTime)
- 2026-10-06 5a24cfb + uncommitted — supervisor scoping moved from deployments.supervisor_id to company (both supervisors identical powers) — result: pass (backend 80/80, build ok)
- 2026-10-05 d4b17ed — workflow check: changed.sh said unchanged; ran tests — result: no activity tests; full suite 2/6 pass, 4 error (sqlite MODIFY migration, pre-existing, not fixed)
- 2026-10-05 cef02dc — first log created from code reading (no tests run) — result: n/a
