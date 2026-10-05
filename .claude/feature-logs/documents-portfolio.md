# Documents, portfolio, reports, downloads, AI narrative
last_commit: cef02dc
updated: 2026-10-05

## Map (where the code lives)
- backend/routes/api.php — intern: L248-253 (documents, portfolio, portfolio/items), L245 activities/polish-narrative; coordinator: L123-124 (interns/{id}/portfolio, /report), L166-168 (documents); supervisor: L191 (interns/{id}/portfolio)
- backend/app/Http/Controllers/Api/InternMonitoringController.php — polishNarrative (L855-873); mapDocument/documents/storeDocument (L1007-1070); portfolioForRequest/portfolio/updatePortfolio/storePortfolioItem/destroyPortfolioItem (L1075-1160)
- backend/app/Http/Controllers/Api/CoordinatorMonitoringController.php — internPortfolio (L294-310, read-only); documents/storeDocument/reviewDocument (L582-695); internReport (L771-835, JSON only, frontend prints)
- backend/app/Http/Controllers/Api/SupervisorMonitoringController.php — internPortfolio (L73-86, read-only, 404 if not own intern)
- backend/app/Services/NarrativeAiService.php (162 lines) — isConfigured, polish (L44), generateFromTasking (L78), private generate (L96): Gemini call, 20s timeout, retry on FALLBACK_MODEL, logs to AiUsageLog; returns null on any failure so caller saves text as-is
- backend/app/Services/DeploymentSummaryService.php — summarize(): hours (approved attendance), tasks, pending attendance, latest eval; shared by coordinator + supervisor
- backend/app/Models/Document.php, Portfolio.php (present(), items()), PortfolioItem.php. Policies/DocumentPolicy.php is a stub (viewAny=true), not real access control
- frontend/src/app/intern/documents/MyDocuments.jsx (POST /api/intern/documents); intern/portfolio/MyPortfolio.jsx (PATCH /portfolio, POST/DELETE /portfolio/items); intern/portfolio/report/PortfolioReport.jsx (printable)
- frontend/src/app/coordinator/documents/DocumentMonitoring.jsx (upload on behalf + approve/reject); coordinator/reports/InternshipReports.jsx; coordinator/interns/[deploymentId]/report/InternshipReport.jsx; coordinator/interns/[deploymentId]/portfolio/CoordinatorInternPortfolio.jsx
- frontend/src/app/supervisor/interns/[deploymentId]/portfolio/SupervisorInternPortfolio.jsx; supervisor/files/TaskFiles.jsx is only a ComingSoon placeholder
- frontend/src/app/api/download/route.js — same-origin proxy adding Content-Disposition: attachment; accepts only path matching ^storage/[\w./-]+$ without ".."; fetches BACKEND_URL/<path>
- frontend/src/app/api/{intern,coordinator,supervisor}/[...path]/route.js — generic proxies; helpers in lib/{internApi,coordinatorApi,supervisorApi}.js
- DB: documents (deployment_id, uploaded_by, document_type, file_name, file_path, status, remarks); portfolios (intern_id, school_id, title, bio; is_public dropped by 2026_08_22 migration); portfolio_items (portfolio_id, title, description, image_path, project_url); ai_usage_logs

## How it works (max ~10 lines)
- Documents: intern (needs current deployment, else 422) or coordinator uploads; jpg/jpeg/png/pdf/doc/docx, max 5 MB, public disk at documents/{schoolId}; status starts pending. Coordinator approves/rejects (+remarks); intern notified, ActivityLogService records.
- Coordinator document list scoped to the school's deployment ids; dashboard uses documents?status=pending.
- Portfolio: one row per intern, firstOrCreate on intern visit; items have optional image (jpg/png/webp/gif, max 3 MB, portfolio/{internId}) and URL. No approval flow. Coordinator/supervisor views are read-only; portfolio is null if never created.
- Coordinator intern report: hours/tasks/attendance counts/evaluations JSON; frontend uses window.print().
- Narrative AI: intern polishNarrative returns 503 if no Gemini key configured, error if generation returns null; generateFromTasking is used for activity narratives (see activities log).
- Downloads: file_url is the Storage public URL; UI routes through /api/download?path=storage/...&name=...

## How to test
- Existing backend tests: backend/tests/Feature/InternovaApiTest.php only checks seeded schools/companies/deployments; nothing covers documents, portfolio, reports or AI. Run: cd backend && php artisan test
- Manual: intern uploads a PDF at /intern/documents -> coordinator sees it at /coordinator/documents, approves -> intern notified. Add a portfolio item with image; view it from supervisor and coordinator portfolio pages (unassigned intern -> 404 for supervisor). Open the coordinator intern report and print. Request /api/download with a bad path (expect 400).

## History (newest first, keep only the last 5)
- 2026-10-05 cef02dc — initial log created from code read, no tests run — result: n/a
