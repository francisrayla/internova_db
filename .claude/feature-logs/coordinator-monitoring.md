# Coordinator and supervisor monitoring (dashboards, interns, companies, settings, pending, preview, profile)
last_commit: 1b9390d + uncommitted
updated: 2026-10-05

## Map (where the code lives)
- backend/routes/api.php — coordinator group (role:coordinator) from L108: interns L121-135, companies L137-141, supervisors L143-146, users resend-invitation/email L150-151, school-settings L153-154 (GET only now; PATCH moved to Dean). Billing routes removed from this group; supervisor group from L184: interns L188-189
- backend/app/Http/Controllers/Api/CoordinatorMonitoringController.php (1710 lines) — deploymentIdsForSchool/deploymentForSchool (L64-85); schoolSettings read-only (updateSchoolSettings removed, now DeanController); sendAccountInvitation delegates to AccountInvitationService; resendInvitation/updatePendingEmail (updatePendingEmail now restricted to supervisor/intern); interns (L274); companies/storeCompany/updateCompany/companyDetail/destroyCompany (L837-985); supervisors CRUD (L988-1160); storeIntern (L1166); previewInternImport/importInterns/analyzeInternImport (L1271-1500); destroyIntern (L1504); updateInternStatus (L1553); updateDeployment (L1584); reassignIntern (L1633); internOptionsForSchool (L1697)
- backend/app/Http/Controllers/Api/SupervisorMonitoringController.php (953 lines) — deploymentForSupervisor (L40-48); interns (L50-71): only deployments where supervisor_id = me
- backend/app/Services/DeploymentSummaryService.php — row shape for intern lists on both sides
- backend/app/Models: InternshipDeployment (school/intern/company/supervisor/coordinator belongsTo), Company (deployments), InternProfile, SupervisorProfile, CoordinatorProfile, School
- backend/app/Policies: Attendance/Document/Evaluation/Message/Task/User policies are 11-line stubs (viewAny=true); real access control is server-side scoping by school_id / supervisor_id plus role middleware, not policies
- frontend/src/app/coordinator/dashboard/CoordinatorDashboard.jsx (fetches interns, tasks, documents?status=pending, evaluations); interns/InternMonitoring.jsx (459 lines), interns/import/ImportInterns.jsx, interns/archive/ArchivedInterns.jsx; companies/PartnerCompanies.jsx + companies/[id]/CompanyDetail.jsx; settings/SchoolSettings.jsx (read-only SchoolDetailsCard + NarrativeReportCard); pending/PendingApproval.jsx (also used by /dean/pending); preview moved to /dean/preview; profile/MyProfile.jsx
- frontend/src/app/supervisor/dashboard/SupervisorDashboard.jsx (interns + attendance?status=pending); interns/AssignedInterns.jsx; profile/MyProfile.jsx wraps components/StaffProfile
- frontend/src/lib/coordinatorApi.js, supervisorApi.js — fetchCoordinatorData/fetchSupervisorData; proxies at app/api/{coordinator,supervisor}/[...path]/route.js
- DB: internship_deployments, companies, users (role, school_id, status, email_bounced_at), intern_profiles, supervisor_profiles, coordinator_profiles, schools

## How it works (max ~10 lines)
- Every coordinator query is scoped to the user's school_id; supervisor queries to deployments.supervisor_id = user id. Out-of-scope ids return 404.
- Interns list = deployments mapped via DeploymentSummaryService::summarize (hours from approved attendance, task counts, latest eval).
- New interns/supervisors get an invitation email (7-day expiry, they set their own password); resend and email change allowed while pending activation.
- A coordinator whose school subscription is not active is redirected by coordinator/layout.jsx to /coordinator/subscription-status ("Waiting for your Dean"); only the Dean pays. Billing/School Settings edit are gone from the coordinator nav (School Settings stays as read-only).
- School settings are edited by the Dean (DeanController::updateSchoolSettings, contact_number 11 digits); coordinator PATCH -> 405. The school's single coordinator is invited by the Dean (is_primary_coordinator=true kept for NarrativeTemplateService).
- Company delete is blocked (422) while supervisors or deployments exist.

## How to test
- Existing backend tests in backend/tests/Feature: InternovaApiTest (seeded schools/companies/deployments list), InternovaSeederTest, SuperadminApiTest, ExampleTest; none cover coordinator/supervisor monitoring endpoints. Run: cd backend && php artisan test
- Manual: as coordinator add a company, a supervisor, and interns (single and import); check list and dashboard counts; reassign an intern; delete a company with deployments (expect 422); coordinator PATCH school-settings (expect 405). As supervisor confirm only own interns appear.

## History (newest first, keep only the last 5)
- 2026-10-05 1f8447e + uncommitted — reviewDocument now sets reviewed_at; CoordinatorFeedbackController gained acknowledge/reply (threads) — result: pass (see dean log)
- 2026-10-05 1b9390d + uncommitted — Phase 2: added ActivityLogService records (updateCompany, updateSupervisor, storeEvaluationCriterion, store(Sub)taskComment) and coordinator "Dean Feedback" nav/page/badge (CoordinatorFeedbackController, FeedbackUnreadWatcher in coordinator/layout.jsx); see dean.md — result: tests 33/33
- 2026-10-05 1b9390d + uncommitted — removed billing routes and school-settings PATCH, read-only settings, waiting-for-Dean gate; see dean.md — result: tests 23/23 pass (see dean.md)
- 2026-10-05 cef02dc — initial log created from code read (function-list grep, line ranges approximate), no tests run — result: n/a
