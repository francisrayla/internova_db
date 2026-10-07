# Notifications (in-app bell, history, realtime)
last_commit: a45b3e4 + uncommitted
updated: 2026-10-07

## Map (where the code lives)
- backend/app/Services/NotificationService.php — send (L22) creates row + broadcast (try/catch, Reverb failure never breaks caller); toSuperadmin, toSchoolCoordinators, toSchoolDean (new: audience `dean`, targets the school's dean user, skip+log if none), toUser. ~31 call sites in backend/app go through it.
- backend/app/Http/Controllers/Api/NotificationController.php — scopedQuery (L12), index (L38, latest 30, important only), history (L68), markRead (L101, no ownership check), markAllRead (L109). Routes in backend/routes/api.php L84-87 (auth:sanctum).
- backend/app/Events/NotificationCreated.php — ShouldBroadcastNow, public channels: `superadmin-notifications`, `school.{id}.{role}-notifications`, plus `user.{id}-notifications` when user_id set; event `.notification.created`.
- backend/routes/channels.php — only a comment: public channels, no Broadcast::channel entries.
- backend/app/Listeners/Send{Task,Comment,Evaluation}Notification.php — empty stub classes, unused.
- backend/app/Models/Notification.php; migrations 2026_08_13_073813_create_notifications_table, 2026_08_13_083534_add_important_to_notifications_table. DB columns: audience_role, school_id, user_id, type, title, body, link, important, read_at.
- frontend/src/components/NotificationBell.jsx (170, dropdown + Echo listener), NotificationHistory.jsx (134, full page list).
- frontend/src/app/{intern,coordinator,supervisor,superadmin,dean}/notifications/ (e.g. InternNotifications.jsx wraps NotificationHistory + page.jsx).
- frontend/src/app/api/notifications/{route.js,history,mark-all-read,[id]/read} — proxies.
- frontend/src/lib/echo.js (getEcho, Reverb via NEXT_PUBLIC_REVERB_* env), lib/useLiveRefresh.js (subscribes user channel, refetches when payload.type in given list; used by intern pages and superadmin dashboard/billing/plans/schools).
- Timestamps (notification/message created_at, events) are formatted via ->local() (Manila, see attendance.md Map: App\Support\LocalTime).
- frontend/src/components/MessengerWidget.jsx — chat widget: ChatWindow message list + always-visible 'Message actions' menu; CreateGroupModal (portal, z-[100], bg-black/60, Esc/focus trap/scroll lock).

- BELL NUMBER (2026-10-07): the red number is `new_count` (unread AND created after users.notifications_seen_at), not `unread_count`. Opening the bell calls POST /api/notifications/seen (NotificationController::markSeen; Next proxy app/api/notifications/seen/route.js — every new backend route here needs its own proxy file); the blue dots / "Mark all read" still use unread_count. NotificationBell.jsx: newCount, openRef, markSeen(). Migration 2026_10_13_000000. Tests: NotificationSeenTest.

## How it works
- Backend action -> NotificationService::send/to* -> Notification row -> broadcast NotificationCreated on Reverb. Bell loads GET /notifications (audience_role, school_id, user_id) and listens live.
- `important=false` rows are not shown in bell/history; they exist only to wake useLiveRefresh listeners (e.g. echoing an action to other tabs).
- Scope: user_id null = whole audience (role+school); with user_id = personal plus audience-wide rows.
- Security note: public channels and request-supplied audience/user ids (no server-side ownership check) by design.

## How to test
- Existing tests: none in backend/tests/Feature cover notifications. `php artisan test` from backend/.
- Manual: run `php artisan reverb:start` and frontend; trigger an action (coordinator invites, plan change request, task approval); bell should update live for target role; mark read / mark all read; open role's /notifications page. Without Reverb, API still works (warning logged).

## History (newest first, keep only the last 5)
- 2026-10-07 uncommitted — supervisors are no longer pinged on every intern clock in/out ('attendance_logged' removed); the only attendance news is 'attendance_auto_closed' (intern forgot to time out, link /supervisor/attendance); intern gets 'attendance_edited' when a supervisor corrects the time — result: AutoClockOutTest 7/7, full suite 146/146
- 2026-10-07 uncommitted — bell number clears when the list is opened (server-side seen_at, per person), notifications stay unread until clicked — result: NotificationSeenTest 4/4, full suite 130/130, headless: open->cleared, reload->cleared, new notification->1, open->cleared
- 2026-10-06 5a24cfb + uncommitted — timestamps Manila via ->local(); MessengerWidget: New group chat modal made a proper modal, message ⋮ always visible (note: earlier uncommitted History lines of this log were lost by accident, only HEAD content restored) — result: tests pass, lint ok
- 2026-10-06 5a24cfb + uncommitted — (restored by main session; lines lost in a truncate) company-wide supervisors: clock-in/out and task-completed notifications now fan out to every ACTIVE supervisor of the intern's company via InternshipDeployment::notifySupervisors (no duplicates); dean_feedback / dean_feedback_reply / dean_feedback_ack types added earlier for two-way Dean feedback — result: pass
- 2026-10-05 1f8447e + uncommitted — new notification types dean_feedback_reply, dean_feedback_ack (to dean), dean_feedback reused for coordinator-bound replies/resolve/reopen — result: pass (see dean log)
