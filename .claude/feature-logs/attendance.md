# Attendance (intern / supervisor / coordinator, incl. offline queue)
last_commit: 5a24cfb + uncommitted
updated: 2026-10-06

## Map (where the code lives)
- frontend/src/app/intern/attendance/Attendance.jsx (597 lines) — clock in/out camera+GPS flow (submit ~L279-306: enqueue when offline, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)); history/list view ~L455-480 handles offline load.
- frontend/src/app/intern/attendance/AttendanceCard.jsx — row card + STATUS_STYLES; history/AttendanceHistory.jsx + history/page.jsx — full history.
- frontend/src/lib/offlineQueue.js (144) — enqueueAttendance L69, getPendingAttendance L79, syncPendingAttendance L93, isNetworkError L58, SUBMIT_TIMEOUT_MS=20000 L53, QUEUE_CHANGED_EVENT. Pending entries saved on device (selfie, lat/lng, deviceTime, anchoredTime).
- frontend/src/lib/trustedClock.js — syncTrustedClock/trustedNow/DISPLAY_TIME_ZONE (Asia/Manila); frontend/src/app/api/server-time/route.js feeds it.
- frontend/src/lib/offlineCache.js — clearOfflineCaches; frontend/public/sw.js — service worker (weak-connection handling, commit ada7bcb); frontend/src/components/PwaRegister.jsx — registers it in production only.
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

- Supervisor attendance list/log/review use visibleToSupervisor; intern clock in/out notifies ALL active company supervisors (notifySupervisors, one row each). (see coordinator-monitoring log for the shared rule)

- backend/app/Support/LocalTime.php — ONE display tz (config app.display_timezone, env APP_DISPLAY_TIMEZONE, default Asia/Manila; storage stays UTC): today()/todayDate()/date()/time()/format()/of()/dayBounds()/whereLocalDate(); Carbon macro ->local() (AppServiceProvider) used for every human ->format() of a datetime column; use LocalTime::today()/date($clockTime) for any 'today'/attendance_date, whereLocalDate for whereDate on datetime columns (completed_at). Tests: tests/Feature/LocalTimeTest.php

## How it works
Intern clocks in/out with selfie + GPS -> POST /api/intern/attendance/clock-in|out -> proxy -> InternMonitoringController. If offline or a network error/20s timeout, entry is queued locally (offlineQueue) with device/trusted time; OfflineStatus syncs when online and flags rows *_is_offline with synced_at; rejected ones are reported back. Offline intern is landed on Attendance page. Clock-out/auto clock-out triggers narrative job creating a "recorded" daily activity. Supervisor logs and reviews (PATCH) attendance; coordinator only views.

## How to test
- No attendance tests in backend/tests/Feature (InternovaApiTest, InternovaSeederTest, SuperadminApiTest, ExampleTest only; none cover attendance). Run: `cd backend && php artisan test`.
- Manual: intern login, clock in with camera/GPS; DevTools Network -> Offline, clock in again, confirm queued badge, go online and confirm sync + offline flag; reload while offline confirms landing on /intern/attendance; supervisor page shows/approves; coordinator page lists.

## History (newest first, keep only the last 5)
- 2026-10-06 5a24cfb + uncommitted — main session: local demo attendance for deployment 1 (58 rows, selfie demo-*) shifted -8h so it is stored as UTC like real data (it had been inserted as Manila wall-clock); ledger now shows 07:57 AM–04:17 PM. Verified messenger: ⋮ visible on every bubble (390/1229), New group modal z-100 with black/60 backdrop, focus in the name field. Also re-encoded this file to UTF-8 (a cp1252 0x97 dash had crept in) — result: pass
- 2026-10-06 5a24cfb + uncommitted — TIMEZONE FIX: clock times formatted Manila (->local()), attendance_date/today/day_ends_at/activity default from LocalTime (was UTC, 00:00-07:59 Manila clock-ins landed on yesterday); offline device_time offset respected; LocalTimeTest added — pass
- 2026-10-06 5a24cfb + uncommitted — supervisor scoping moved from deployments.supervisor_id to company (both supervisors identical powers) — result: pass (backend 80/80, build ok)
- 2026-10-06 5a24cfb + uncommitted — sw.js SELF_DESTRUCT: on localhost/127.0.0.1 a worker registered without ?keep=1 (old dev registrations, e.g. the user's Edge) skips caching, and on activate deletes internova-* caches, unregisters and reloads open tabs. PwaRegister registers /sw.js?keep=1 in production builds, so deployed sites and local `npm start` keep offline mode. Verified in headless Chrome (old-style registration → 0 registrations, 0 caches) and by evaluating the flag for 4 URLs — result: pass
- 2026-10-05 2489d09 + uncommitted — PwaRegister: service worker registers in production only; in `next dev` it unregisters any old worker and clears internova-* Cache Storage (offline clock-in queue is IndexedDB, untouched). Offline mode must be tested with build + start — result: tests 16/16, build ok
