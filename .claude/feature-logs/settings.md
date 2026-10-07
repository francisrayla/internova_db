# Settings hub (all roles)
last_commit: 6bc841a
updated: 2026-10-07

## Map
- frontend/src/components/settings/{SettingsHub,SettingsScreen,RoleSettingsHub}.jsx — hub cards per role (config lives in RoleSettingsHub.jsx HUBS), back-link frame. RULE: Settings lists only what has no other place in the app — nothing that is already in the sidebar or header (no Appearance, billing, plans, grading criteria, coordinator).
- Routes per role: app/<role>/settings (hub), settings/account (AccountSettings). Extra: dean settings/school + settings/notifications (WeeklyEmailPreference); coordinator settings/school (read-only) + settings/narrative (NarrativeReportCard); supervisor settings/attendance (AttendanceSettings.jsx, company attendance format); superadmin settings/system (SystemSettings).
- Old addresses still work: app/<role>/account and superadmin/system-settings redirect to the new screens.
- Layouts (app/<role>/layout.jsx): profile menu has ONE "Settings" entry; coordinator keeps a sidebar "Settings" (was School Settings); the Dean's sidebar entry was removed (profile menu only).
- Backend: DeanWeeklySummaryService email link -> /dean/settings/notifications.

## How to test
- Log in as each role (password `password`, e.g. dean@/coordinator@/supervisor@/intern@/superadmin@internova.test), open Settings from the profile menu and click every card; check 390px and dark mode.

## History (newest first, keep only the last 5)
- 2026-10-07 uncommitted — trimmed per the owner: Settings no longer repeats sidebar/header items (Appearance, Plans, Billing, Coordinator, Grading criteria removed); Dean sidebar Settings removed — result: lint ok, headless check of all hubs ok
- 2026-10-07 uncommitted — Next proxy now forwards PUT (the supervisor attendance format save was a 405 there); click-through save verified in headless Chrome
- 2026-10-07 uncommitted — created: one Settings hub per role, each setting on its own screen — result: lint ok, headless 1440/390 check of all hubs and screens ok, backend DeanInsightsTest 21/21
