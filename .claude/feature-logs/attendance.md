# Attendance (intern / supervisor / coordinator, incl. offline queue)
last_commit: cef02dc
updated: 2026-10-05

## Map (where the code lives)
- frontend/src/app/intern/attendance/Attendance.jsx (597 lines) — clock in/out camera+GPS flow (submit ~L279-306: enqueue when offline, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)); history/list view ~L455-480 handles offline load.
- frontend/src/app/intern/attendance/AttendanceCard.jsx — row card + STATUS_STYLES; history/AttendanceHistory.jsx + history/page.jsx — full history.
- frontend/src/lib/offlineQueue.js (144) — enqueueAttendance L69, getPendingAttendance L79, syncPendingAttendance L93, isNetworkError L58, SUBMIT_TIMEOUT_MS=20000 L53, QUEUE_CHANGED_EVENT. Pending entries saved on device (selfie, lat/lng, deviceTime, anchoredTime).
- frontend/src/lib/trustedClock.js — syncTrustedClock/trustedNow/DISPLAY_TIME_ZONE (Asia/Manila); frontend/src/app/api/server-time/route.js feeds it.
- frontend/src/lib/offlineCache.js — clearOfflineCaches; frontend/public/sw.js — service worker (weak-connection handling, commit ada7bcb).
- frontend/src/components/OfflineStatus.jsx — runs syncPendingAttendance, fires ATTENDANCE_SYNCED_EVENT.
- frontend/src/lib/roleDashboard.js — resolveLandingPath (L56): intern offline lands on /intern/attendance (commit 2ff640e); used by app/login/Login.jsx and app/page.jsx.
- frontend/src/app/intern/layout.jsx — nav + warm-up prefetch list (/api/intern/attendance, /today) L19-25.
- frontend/src/app/supervisor/attendance/InternAttendance.jsx (212) — supervisor logs/reviews attendance.
- frontend/src/app/coordinator/attendance/AttendanceMonitoring.jsx (230) — view-only.
- Proxies: frontend/src/app/api/{intern,supervisor,coordinator}/[...path]/route.js (catch-all to backend; no attendance-specific files). Helpers: lib/internApi.js, supervisorApi.js, coordinatorApi.js, apiFetch.js.
- backend/routes/api.php — intern L237-240 (GET attendance, attendance/today, POST attendance/clock-in, clock-out); supervisor L193-195 (GET, POST attendance, PATCH attendance/{id}); coordinator L155-156 (GET attendance/companies, attendance).
- backend/app/Http/Controllers/Api/InternMonitoringController.php — attendance L499, attendanceToday L522, clockIn L619, clockOut L677 (dispatches GenerateNarrativeForAttendance L731, L776).
- .../SupervisorMonitoringController.php — attendance L450, storeAttendance L493, reviewAttendance L530.
- .../CoordinatorMonitoringController.php — attendanceCompanies L345, attendance L363.
- backend/app/Models/Attendance.php (boot hook ~L61 also dispatches narrative job); backend/app/Jobs/GenerateNarrativeForAttendance.php.
- DB: attendances (create in 2026_08_11_000001_create_internova_schema.php L141); migrations add selfie/gps (2026_08_17_010000), auto_clocked_out (2026_09_24_120000), offline tracking clock_in/out_is_offline + *_synced_at (2026_10_01_010000); attendance_captures table in schema SQL.

## How it works
Intern clocks in/out with selfie + GPS -> POST /api/intern/attendance/clock-in|out -> proxy -> InternMonitoringController. If offline or a network error/20s timeout, entry is queued locally (offlineQueue) with device/trusted time; OfflineStatus syncs when online and flags rows *_is_offline with synced_at; rejected ones are reported back. Offline intern is landed on Attendance page. Clock-out/auto clock-out triggers narrative job creating a "recorded" daily activity. Supervisor logs and reviews (PATCH) attendance; coordinator only views.

## How to test
- No attendance tests in backend/tests/Feature (InternovaApiTest, InternovaSeederTest, SuperadminApiTest, ExampleTest only; none cover attendance). Run: `cd backend && php artisan test`.
- Manual: intern login, clock in with camera/GPS; DevTools Network -> Offline, clock in again, confirm queued badge, go online and confirm sync + offline flag; reload while offline confirms landing on /intern/attendance; supervisor page shows/approves; coordinator page lists.

## History (newest first, keep only the last 5)
- 2026-10-05 cef02dc — first log created from code reading (no tests run) — result: n/a
