# Auth (login, signup verification, password reset, invitations)
last_commit: 1b9390d + uncommitted
updated: 2026-10-05

## Map (where the code lives)
- backend/routes/api.php (L57-87, L256-261) — public: auth/login, forgot-password, verify-reset-code, reset-password (throttle 10/min), verify-email (throttle), resend-verification, webhooks/resend (throttle 120), invitations/{token} show+accept; auth:sanctum group: logout, change-password, profile, avatar, session/{id}.
- backend/app/Http/Controllers/Api/AuthController.php — login (L15-65), logout, changePassword, updateProfile, avatar, session (L153), buildUserPayload (L174).
- .../EmailVerificationController.php — sendCode (static, L21), verify (L52), resend (L80); 15 min expiry.
- .../PasswordResetController.php — forgotPassword (L24), verifyResetCode (L73), resetPassword (L87); 15 min expiry.
- .../InvitationController.php — findValidUser (L15), show (L22), accept (L43, DB transaction).
- .../ResendWebhookController.php — handle (L24, email.bounced -> email_bounced_at), hasValidSignature (L49, Svix HMAC).
- backend/app/Services/EmailDeliverability.php — problem() (L30): typo list + MX/DNS check; used in CoordinatorMonitoringController (~L250, L1182, L1472) before sending invites.
- backend/app/Mail/{AccountInvitation,EmailVerification,PasswordReset}.php + resources/views/emails/{account-invitation,email-verification,password-reset}.blade.php (all queued). Invite send: App\Services\AccountInvitationService::send (CoordinatorMonitoringController::sendAccountInvitation delegates; DeanController and SuperadminFullController::inviteDean use it).
- backend/app/Http/Middleware/EnsureRole.php (alias `role:`, bootstrap/app.php L20), EnforceMaintenanceMode.php, AutoCloseStaleAttendance.php.
- backend/app/Http/Controllers/Api/SuperadminFullController.php — storeInquiry (L120): public signup (Inquiry form), creates a DEAN account (was coordinator) then EmailVerificationController::sendCode. No separate /register route.
- frontend/src/app/login/Login.jsx (142 lines); app/verify-email/VerifyEmail.jsx (150; Spam/Promotions hint ~L94, resend handler L49, notice ~L136); app/forgot-password/ForgotPassword.jsx (246, multi-step); app/accept-invite/[token]/.
- frontend/src/app/api/auth/{login,logout,session,profile,avatar,change-password,forgot-password,verify-reset-code,reset-password,verify-email,resend-verification}/route.js and api/invitations/[token]/{route.js,accept} — thin proxies to Laravel.
- frontend/src/lib: apiFetch.js (Bearer from localStorage `internova_token`, clears on 401), serverProxy.js (forwardHeaders, createApiProxy), UserContext.js, roleDashboard.js (role -> dashboard), backendUrl.js.
- DB: users (email_verified_at, password, invitation_token sha256, invitation_expires_at, email_bounced_at, role_id), email_verification_tokens, password_reset_tokens, personal_access_tokens (Sanctum).

## How it works
- Login: email+password -> 401 generic on failure; 403 `needsVerification` if email_verified_at null; 503 `maintenance` for non-superadmin (role_id 1) when Setting maintenance_mode=1. Success deletes old tokens, issues a new Sanctum token + user payload.
- Signup (inquiry form) -> 6-digit code (sha256 stored) emailed -> /verify-email -> email_verified_at set. Resend always returns the same message (anti-enumeration). Commit 85e28de: VerifyEmail shows Spam/Promotions hint and a confirmation after resend that only the newest code works.
- Password reset: forgot -> code emailed (only if user has password) -> verify code -> reset; same response whether or not email exists.
- Invitations: coordinator invites supervisor/intern; token hashed in users; accept sets password (email considered verified). EmailDeliverability pre-checks address; Resend webhook records bounces.
- Roles: superadmin / dean / coordinator / supervisor / intern, route groups use auth:sanctum + role:X (dean group also dean.school middleware on billing). Login returns 403 for status `inactive` (deactivated coordinator). Invitations are now also used by the Dean (coordinator invite) and superadmin (dean invite) via AccountInvitationService; accept works for any role.

## How to test
- Existing tests: none for auth in backend/tests/Feature (ExampleTest, InternovaApiTest, InternovaSeederTest, SuperadminApiTest contain no login/verify/notification cases per grep). Run `php artisan test` from backend/.
- Manual: login with unverified account (expect 403 needsVerification); submit inquiry, check mail (log/queue worker needed for queued mail), verify code, login; forgot-password flow; coordinator invites intern, open /accept-invite/<token>; click Resend code on /verify-email and see confirmation + Spam hint.

## History (newest first, keep only the last 5)
- 2026-10-05 1b9390d + uncommitted — AuthController::login stores users.last_login_at (migration 2026_10_07_000000) for the Dean's "last active" — result: tests pass
- 2026-10-05 1b9390d + uncommitted — added dean role, inactive-login block, dean_position in payload, shared AccountInvitationService; see dean.md — result: tests 23/23 pass (see dean.md)
- 2026-10-05 cef02dc — initial log created (documentation only) — result: n/a, nothing run
