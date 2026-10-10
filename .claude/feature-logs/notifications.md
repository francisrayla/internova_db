# Notifications (in-app bell, history, realtime)
last_commit: 8c21eaf + uncommitted
updated: 2026-10-10

## Map (where the code lives)
- backend/app/Services/NotificationService.php — send (L22) creates row + broadcast (try/catch, Reverb failure never breaks caller); toSuperadmin, toSchoolCoordinators, toSchoolDean (new: audience `dean`, targets the school's dean user, skip+log if none), toUser. ~31 call sites in backend/app go through it.
- backend/app/Http/Controllers/Api/NotificationController.php — scopedQuery(Request) builds EVERY feed from the token user only (audience = role, school_id = user school, user_id null or self; super admin has no school filter); index, history, markRead (scoped findOrFail -> 404), markAllRead, markSeen, attention. Request audience_role/school_id/user_id are ignored (the frontend still sends them, harmless). Routes api.php auth:sanctum group.
- backend/app/Events/NotificationCreated.php — ShouldBroadcastNow on PRIVATE channels: `superadmin.notifications`; personal row (user_id) -> only `user.{id}.notifications`; audience row -> `school.{schoolId}.{role}.notifications`; event `.notification.created`. Chat events (MessageSent, GroupMessageSent, UserTyping, GroupUserTyping) use private `user.{id}.messages`.
- backend/routes/channels.php — Broadcast::channel auth: user.{id}.notifications|messages = own id; school.{schoolId}.{role}.notifications = same school + role name; superadmin.notifications = super_admin. Auth endpoint POST /api/broadcasting/auth (bootstrap/app.php withBroadcasting, prefix api, middleware api + auth:sanctum). Reverb allowed_origins from REVERB_ALLOWED_ORIGINS (config/reverb.php).
- backend/app/Listeners/Send{Task,Comment,Evaluation}Notification.php — empty stub classes, unused.
- backend/app/Models/Notification.php; migrations 2026_08_13_073813_create_notifications_table, 2026_08_13_083534_add_important_to_notifications_table. DB columns: audience_role, school_id, user_id, type, title, body, link, important, read_at.
- frontend/src/components/NotificationBell.jsx (170, dropdown + Echo listener), NotificationHistory.jsx (134, full page list).
- frontend/src/app/{intern,coordinator,supervisor,superadmin,dean}/notifications/ (e.g. InternNotifications.jsx wraps NotificationHistory + page.jsx).
- frontend/src/app/api/notifications/{route.js,history,mark-all-read,[id]/read} — proxies.
- frontend/src/lib/echo.js (getEcho: needs a token, recreates the connection when the token changes, channelAuthorization -> /api/broadcasting/auth with Bearer from localStorage; disconnectEcho), always echo.private(...) never echo.channel; frontend/src/app/api/broadcasting/auth/route.js proxies the form post with the Authorization header; lib/useLiveRefresh.js (user.{id}.notifications; used by intern pages and superadmin dashboard/billing/plans/schools).
- Timestamps (notification/message created_at, events) are formatted via ->local() (Manila, see attendance.md Map: App\Support\LocalTime).
- frontend/src/components/MessengerWidget.jsx — chat widget: ChatWindow message list + always-visible 'Message actions' menu; CreateGroupModal (portal, z-[100], bg-black/60, Esc/focus trap/scroll lock).

- BELL NUMBER (2026-10-07): the red number is `new_count` (unread AND created after users.notifications_seen_at), not `unread_count`. Opening the bell calls POST /api/notifications/seen (NotificationController::markSeen; Next proxy app/api/notifications/seen/route.js — every new backend route here needs its own proxy file); the blue dots / "Mark all read" still use unread_count. NotificationBell.jsx: newCount, openRef, markSeen(). Migration 2026_10_13_000000. Tests: NotificationSeenTest.

- ATTENTION LIST (2026-10-09, uncommitted): GET /api/notifications/attention (NotificationController::attention; user-only, query ignored; see dashboards.md) shown on top of the bell panel and the history page; bell red number = new_count + attention items needing action. index/history/markRead/markAllRead are now token-scoped (S2). New files: lib/useAttention.js, app/api/notifications/attention/route.js; bell panel is one scroll area (header + list, 'View all' footer fixed), w-96 from sm, edge-to-edge on phones. New stored types: attendance_deleted (supervisor deleted a record, link /intern/attendance).

- STORAGE PROXY (2026-10-10): frontend/src/app/storage/[...path]/route.js replaces the /storage rewrite in next.config.js (GET/HEAD, forwards content-type/length/range/etag, sets nosniff + restrictive CSP + no-referrer).

## How it works
- Backend action -> NotificationService::send/to* -> Notification row -> broadcast NotificationCreated on Reverb. Bell loads GET /notifications (audience_role, school_id, user_id) and listens live.
- `important=false` rows are not shown in bell/history; they exist only to wake useLiveRefresh listeners (e.g. echoing an action to other tabs).
- Scope: user_id null = whole audience (role+school); with user_id = personal plus audience-wide rows.
- Security (S2): all channels private + authorized; feeds scoped to the token user. Tests: backend/tests/Feature/RealtimeAccessTest.php (12). Verified live on a real Reverb: own channel ok, foreign channel 403, public name receives nothing.

## How to test
- Tests: RealtimeAccessTest, NotificationSeenTest, NotificationAttentionTest. `php artisan test` from backend/.
- Manual: run `php artisan reverb:start` and frontend; trigger an action (coordinator invites, plan change request, task approval); bell should update live for target role; mark read / mark all read; open role's /notifications page. Without Reverb, API still works (warning logged).

## History (newest first, keep only the last 5)
- 2026-10-10 8c21eaf + uncommitted — cross-cutting QA realtime: 2 QA sessions on real Reverb: own private channels 200, other user / other role / other school / superadmin / no token = 403/401 (direct + via Next proxy), old token after re-login 401; bell updates live and reconnects with new subscriptions after token change; 7 MB heap. FIXED the /storage hardening: Next does not apply headers() to the external rewrite, so nosniff+CSP never reached the browser; /storage now served by src/app/storage/[...path]/route.js (adds the headers, html/svg -> octet-stream, no path traversal); next.config.js adds nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy on every route and drops X-Powered-By (no CSP for pages: inline scripts) — result: headers verified with curl on dev :3011; needs a rebuild to reach :3010
- 2026-10-10 8c21eaf + uncommitted — S2: notifications IDOR fixed (token-user scoping, markRead 404), Reverb chat+notifications moved to private channels with auth route + Next proxy, channel names renamed (dots), personal notifications no longer sent on the role channel — result: RealtimeAccessTest 12/12, live Reverb handshake ok
- 2026-10-09 8c21eaf + uncommitted — phase A restyle: AttentionQueue is now a hairline list (no bordered colour boxes), bell/trigger 44px on phones, dark palette from globals tokens — result: bell checked light/dark 1440/390
- 2026-10-09 uncommitted — attention list in the bell (all 5 roles) + attendance_deleted type — result: NotificationAttentionTest 8/8, headless bell 5 roles x light/dark x 390/1440 ok
- 2026-10-08 uncommitted — new type 'attendance_red_flag' (Attendance::notifyOddHoursClockIn via InternshipDeployment::notifySupervisors, one row per active company supervisor, link /supervisor/attendance?flag=unchecked); never sent to Dean/coordinator (see attendance log) — result: AttendanceRedFlagTest 14/14
