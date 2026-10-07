# OJT certificate of completion (supervisor)
last_commit: 6bc841a
updated: 2026-10-07

## Map
- backend/database/migrations/2026_10_12_000000_create_certificate_templates_table.php + app/Models/CertificateTemplate.php — ONE .pptx template per company (company_id unique), file on the `public` disk under certificate-templates/{company}/ (that disk is the Railway volume; never expose the URL).
- backend/app/Services/CertificateService.php — PLACEHOLDERS ({{NAME}} required, COURSE, HOURS, COMPANY, SCHOOL, START_DATE, END_DATE, DATE, SUPERVISOR), isPresentation(), markersIn(), fill(): rewrites ppt/slides/*.xml with DOM; a marker typed in one run keeps its formatting, a marker PowerPoint split over runs is merged into the paragraph's first run; text set through createTextNode so names with & < " stay valid.
- backend/app/Http/Controllers/Api/SupervisorCertificateController.php — show (template, markers, interns active+completed with hours), upload (.pptx only, must contain {{NAME}}, replaces + deletes the old file), destroy, sample (resources/certificate/sample-certificate-template.pptx, built with python-pptx), generate (returns the filled .pptx; interns scoped by InternshipDeployment::visibleToSupervisor).
- routes/api.php supervisor group: GET /certificates, POST /certificates/template, DELETE /certificates/template, GET /certificates/sample, POST /certificates/generate.
- frontend/src/app/supervisor/certificates/{page,Certificates}.jsx — step 1 template (upload/replace/remove, marker help, sample download), step 2 pick intern -> name prefilled/editable, CAPS option, other details; download via blob. Nav item "Certificates" in app/supervisor/layout.jsx. The Next proxy already passes binary responses through.

## How to test
- Backend: `DB_PORT=<port> php artisan test --filter=CertificateTest` (8 tests). Manual: supervisor@internova.test -> Certificates, download the sample, upload it, generate; open the result in PowerPoint (python-pptx can read it too).

## History (newest first, keep only the last 5)
- 2026-10-07 uncommitted — created: template upload + fill + download — result: CertificateTest 8/8, full suite pass, headless upload->generate->real download at 1440 light and 390 dark OK
