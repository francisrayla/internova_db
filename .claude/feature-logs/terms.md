# Terms and Conditions + Privacy Notice acceptance
last_commit: 182fb09
updated: 2026-10-15

## Map (where the code lives)
- backend/config/internova.php — `terms_version` ('2026-10-15'): the ONE backend version string. Frontend twin: frontend/src/lib/legal.js TERMS_VERSION (+ TERMS_UPDATED_LABEL, getSupportEmail()). Bump BOTH when the text changes.
- backend/database/migrations/2026_10_19_000000_add_terms_acceptance_columns.php — terms_accepted_at (timestamp null) + terms_version (string 20 null) on users and plan_inquiries; reversible (down drops them).
- backend/app/Models/User.php (Fillable + cast), PlanInquiry.php (fillable + cast).
- backend/app/Http/Controllers/Api/SuperadminFullController.php — storeInquiry: `accept_terms` => accepted (custom message), stamps user + inquiry, excludes accept_terms from PlanInquiry::create; convertInquiryToSchool copies the inquiry's acceptance to the dean user if the user has none.
- backend/app/Http/Controllers/Api/InvitationController.php — accept: `accept_terms` => accepted, stamps user (all invited roles: dean, coordinator, supervisor, intern).
- backend/routes/api.php — public GET /api/legal -> {terms_version, support_email (system setting)}; used by the /terms and /privacy pages.
- frontend/src/app/terms/page.jsx, app/privacy/page.jsx — server components, DRAFT text (code comment at top), shared frame components/LegalPage.jsx (Page/PageHeader/Section kit + jump list + Bullets). Support email from getSupportEmail() (fetch /api/legal, 5 min revalidate, falls back to support@internova.ai).
- frontend/src/components/TermsCheckbox.jsx — unchecked checkbox, label htmlFor, links open new tab, min-h-11 row, inline error (aria-invalid/describedby).
- Used in app/inquiry/page.jsx (acceptTerms state; body `{...form, accept_terms}`; inline error after a failed submit) and app/accept-invite/[token]/page.jsx (termsError). Links also in app/page.jsx footer and app/login/Login.jsx.
- Super Admin is never created through these paths. Other User::create calls (coordinator/dean invites) only create pending invited users; acceptance is stamped when they accept.

## How it works
Registration form and invitation accept both require accept_terms=true (422 message "You need to agree to the Terms and Conditions and the Privacy Notice to ..."). Version is whatever config('internova.terms_version') is at that moment. Existing users keep NULL (not blocked); a "re-accept on next login" prompt can be added later by comparing users.terms_version with config.

## How to test
- tests/Feature/TermsAcceptanceTest.php (7): missing -> 422 + nothing created, stored on user + inquiry, convert copies, invitation 422/stored for supervisor/coordinator/dean/intern, /api/legal. Other tests posting to /api/inquiries or /accept now send accept_terms (AuthHardeningTest, DeanTest, SupervisorInvitationTest, HeadTitleTest).
- Run on the shared MariaDB :3308 DB `internova_testing` (a guard refuses other DB names); another agent running at the same time causes random "table doesn't exist" errors: rerun.
- Browser: /terms, /privacy at 1440 + 390, light + dark; invite page with unchecked box -> inline error.

## History (newest first, keep only the last 5)
- 2026-10-15 182fb09 — feature built: columns, validation, pages, checkbox, links — result: 51/51 filtered tests, eslint clean on changed files, browser checked
