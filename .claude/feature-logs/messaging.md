# Messaging (1:1 chat + groups, MessengerWidget)
last_commit: 3b3e038
updated: 2026-10-15

## Map (where the code lives)
- backend/app/Http/Controllers/MessageController.php — eligibleContacts (L37, THE rule of who may chat with whom; isEligibleContact reuses it for thread/store/forward/typing/settings), mapContact (L199, adds role + role_label), contacts (L236), thread (L309), store (L339), createGroup (L559; filters role dean out of member candidates). Routes: routes/api.php `/messages/*` inside `school.active` group (contacts, thread/{id}, store, forward, typing, settings, groups...).
- Events (App\Events\MessageSent, GroupMessageSent, UserTyping, GroupUserTyping) -> PRIVATE channel `user.{receiver}.messages`, authorised in routes/channels.php (own id only); see notifications.md.
- frontend/src/components/MessengerWidget.jsx — widget (list, ChatWindow, CreateGroupModal); helpers roleLabelOf/displayNameOf (top of file, L13-18: dean contact shows "Name · Principal" from API role_label); mounted by AppShell via `messengerCurrentUser={user}` in coordinator, supervisor, intern AND dean layouts (app/dean/layout.jsx; the gated Dean MinimalTopBar has no chat).
- Phone layout (< 640px, 3b3e038, MessengerWidget.jsx): useIsPhone (useSyncExternalStore on matchMedia, ~L68), ConversationRow (phone + desktop row), ChatWindow `phone`/`onBack` props (full-screen header with back arrow, 44px composer, 16px input), main widget: activeKey + histDepthRef/pushLevel/stepBack/popstate effect, body scroll lock, renderChat(c, phone), list portal `msg-screen` (Chats header, X, new group, search). globals.css `.msg-screen` (fixed, top --vv-top, bottom --kb, safe-area padding). rem here is 14.4px so use explicit `[44px]` for tap targets, not h-11.
- DB: messages (sender_id, receiver_id, school_id, read_at, attachment_*), message_thread_settings, group_conversations/_members/group_messages.

## How it works
- Who can DM whom (server-derived, never trust receiver_id): coordinator -> own-school supervisors + interns + the school's ACTIVE dean; dean -> ONLY the own-school ACTIVE coordinator(s); supervisor -> interns of their company + school coordinators; intern -> own supervisor/coordinator + company mates. Anyone else = 403.
- The dean is a 1:1-only contact: createGroup drops dean ids; the widget hides dean from the new-group candidates and the dean cannot create groups (GROUP_CREATOR_ROLES).
- Contact `role_label` = HeadTitle::forSchool for the dean (Dean/Principal/School Head), never the hard-coded word.
- Realtime: widget listens on echo.private(`user.{me}.messages`) -> reloads the list (unread badge) and appends to the open thread. Needs Reverb running on :8080 (broadcast failures are only logged as warnings).

## How to test
- backend: `DB_PORT=3308 DB_USERNAME=root DB_PASSWORD= php artisan test --filter=DeanCoordinatorChatTest` (5) plus PaginationMessagesTest, ChatAttachmentSecurityTest, CrossTenantAccessTest.
- browser: two headless Chromes (coordinator@ + dean@internova.test) send each way; check the badge on title="Messages" and the open window update live. Local dev server here used DB internova_db on :3308 (not 3306).

## History (newest first, keep only the last 5)
- 2026-10-15 77a4b89 + 3b3e038 — phone full-screen messenger (list -> conversation, Back/popstate, kb-aware composer); docked widget kept for >= 640px — result: headless Chrome touch 390/360/320 light+dark, realtime both ways, back/close, 1440 + 768 unchanged, build ok, no new lint errors; real iOS/Android keyboard not tested
- 2026-10-15 eec7a93 + 3c11df6 — coordinator <-> dean 1:1 chat (same school only, active only), dean gets the widget, title label via role_label; groups unchanged — result: DeanCoordinatorChatTest 5/5, suite 473/473, browser 1440+390 light+dark both directions live ok
