<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CoordinatorMonitoringController;
use App\Http\Controllers\Api\CoordinatorSubscriptionController;
use App\Http\Controllers\Api\CoordinatorSupportController;
use App\Http\Controllers\Api\InternMonitoringController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\EmailVerificationController;
use App\Http\Controllers\Api\SuperadminFullController;
use App\Http\Controllers\Api\SupervisorMonitoringController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        // Exempt from EnforceMaintenanceMode (see its ALWAYS_ALLOWED list) so
        // the frontend's /maintenance page can poll this to find out when
        // it's safe to send people back, without itself getting a 503.
        'maintenance' => \App\Models\Setting::value('maintenance_mode', '0') === '1',
    ]);
});

Route::prefix('superadmin')->middleware(['auth:sanctum', 'role:super_admin'])->group(function () {

    Route::get('/schools', [SuperadminFullController::class, 'schools']);
    Route::get('/plan-inquiries', [SuperadminFullController::class, 'planInquiries']);
    Route::patch('/plan-inquiries/{id}', [SuperadminFullController::class, 'updateInquiry']);
    Route::post('/plan-inquiries/send-reply', [SuperadminFullController::class, 'sendReply']);
    Route::post('/plan-inquiries/{id}/convert-to-school', [SuperadminFullController::class, 'convertInquiryToSchool']);
    Route::post('/schools/{id}/confirm-payment', [SuperadminFullController::class, 'confirmSchoolPayment']);
    Route::post('/schools/{id}/verify-payment', [SuperadminFullController::class, 'verifySchoolPayment']);
    Route::post('/schools/{id}/toggle-suspend', [SuperadminFullController::class, 'toggleSchoolSuspension']);
    Route::post('/schools/{id}/resend-offer', [SuperadminFullController::class, 'resendSchoolOffer']);
    Route::get('/plans-features', [SuperadminFullController::class, 'plansFeatures']);
    Route::patch('/plans/{id}', [SuperadminFullController::class, 'updatePlan']);
    Route::get('/ai-usage', [SuperadminFullController::class, 'aiUsage']);
    Route::get('/support-messages', [SuperadminFullController::class, 'supportMessages']);
    Route::get('/support-messages/{id}', [SuperadminFullController::class, 'supportMessageShow']);
    Route::post('/support-messages/{id}/reply', [SuperadminFullController::class, 'supportMessageReply']);
    Route::patch('/support-messages/{id}', [SuperadminFullController::class, 'supportMessageUpdateStatus']);
    Route::get('/activity-logs', [SuperadminFullController::class, 'activityLogs']);
    Route::get('/activity-logs/schools', [SuperadminFullController::class, 'activityLogSchools']);
    Route::get('/system-settings', [SuperadminFullController::class, 'systemSettings']);
    Route::patch('/system-settings/{key}', [SuperadminFullController::class, 'updateSystemSetting']);
    Route::get('/plan-change-requests', [SuperadminFullController::class, 'planChangeRequests']);
    Route::post('/plan-change-requests/{id}/approve', [SuperadminFullController::class, 'approvePlanChange']);
    Route::post('/plan-change-requests/{id}/reject', [SuperadminFullController::class, 'rejectPlanChange']);
});

// Public endpoint — no auth required; school submits inquiry from the public form
Route::post('/inquiries', [SuperadminFullController::class, 'storeInquiry']);

// Public login — email + password against the users table
Route::post('/auth/login', [AuthController::class, 'login']);

// Public — no auth required; proving control of the email IS the auth here
Route::post('/auth/forgot-password', [PasswordResetController::class, 'forgotPassword']);
// Throttled — a 6-digit code has only a million possibilities, so the
// verify/submit steps need a real rate limit, not just an expiry.
Route::post('/auth/verify-reset-code', [PasswordResetController::class, 'verifyResetCode'])->middleware('throttle:10,1');
Route::post('/auth/reset-password', [PasswordResetController::class, 'resetPassword'])->middleware('throttle:10,1');

// Public — gates login for self-registered (Inquiry form) accounts until
// the code emailed at signup is entered. See AuthController::login().
Route::post('/auth/verify-email', [EmailVerificationController::class, 'verify'])->middleware('throttle:10,1');
Route::post('/auth/resend-verification', [EmailVerificationController::class, 'resend']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);
    Route::patch('/auth/profile', [AuthController::class, 'updateProfile']);
    Route::post('/auth/avatar', [AuthController::class, 'uploadAvatar']);
    Route::delete('/auth/avatar', [AuthController::class, 'deleteAvatar']);

    // Re-check an already-logged-in account's current status (approval, subscription, etc.)
    // without requiring the password again — used to detect approvals/updates made since login.
    // AuthController::session() further requires the token to belong to this same id.
    Route::get('/auth/session/{id}', [AuthController::class, 'session']);

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::get('/notifications/history', [NotificationController::class, 'history']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);
    Route::post('/notifications/mark-all-read', [NotificationController::class, 'markAllRead']);

    // Direct messages — coordinator/supervisor/intern only, scoped server-side
    // per role by MessageController::eligibleContacts (never trust a
    // client-submitted receiver_id).
    Route::get('/messages/contacts', [MessageController::class, 'contacts']);
    Route::get('/messages/thread/{userId}', [MessageController::class, 'thread']);
    Route::post('/messages', [MessageController::class, 'store']);
    Route::post('/messages/forward', [MessageController::class, 'forwardMessage']);
    Route::post('/messages/typing', [MessageController::class, 'typing']);
    Route::patch('/messages/settings', [MessageController::class, 'updateThreadSetting']);

    // Group chats — coordinator/supervisor create them, but any member
    // (interns included) can read and post once added (see MessageController).
    Route::get('/messages/groups', [MessageController::class, 'groups']);
    Route::post('/messages/groups', [MessageController::class, 'createGroup']);
    Route::get('/messages/groups/{id}', [MessageController::class, 'groupThread']);
    Route::post('/messages/groups/{id}/messages', [MessageController::class, 'storeGroupMessage']);
    Route::post('/messages/groups/{id}/typing', [MessageController::class, 'groupTyping']);
});

Route::prefix('coordinator')->middleware(['auth:sanctum', 'role:coordinator'])->group(function () {
    // Primary coordinator self-service: review/accept the subscription offer and pay
    Route::post('/schools/{id}/accept-offer', [CoordinatorSubscriptionController::class, 'acceptOffer']);
    Route::post('/schools/{id}/checkout', [CoordinatorSubscriptionController::class, 'checkout']);
    Route::post('/schools/{id}/verify-checkout', [CoordinatorSubscriptionController::class, 'verifyCheckout']);
    Route::post('/schools/{id}/upload-proof', [CoordinatorSubscriptionController::class, 'uploadProof']);
    Route::post('/schools/{id}/switch-plan', [CoordinatorSubscriptionController::class, 'switchPlan']);
    Route::post('/schools/{id}/upgrade-plan', [CoordinatorSubscriptionController::class, 'requestUpgrade']);
    Route::post('/schools/{id}/cancel-pending-upgrade', [CoordinatorSubscriptionController::class, 'cancelPendingUpgrade']);
    Route::get('/schools/{id}/upgrade-quote', [CoordinatorSubscriptionController::class, 'upgradeQuote']);
    Route::post('/schools/{id}/request-plan-change', [CoordinatorSubscriptionController::class, 'requestPlanChange']);

    // Day-to-day internship monitoring — always scoped server-side to the
    // authenticated coordinator's own school (see CoordinatorMonitoringController).
    Route::get('/interns', [CoordinatorMonitoringController::class, 'interns']);
    Route::get('/interns/{deploymentId}/portfolio', [CoordinatorMonitoringController::class, 'internPortfolio']);
    Route::get('/interns/{deploymentId}/report', [CoordinatorMonitoringController::class, 'internReport']);
    Route::post('/interns', [CoordinatorMonitoringController::class, 'storeIntern']);
    // Bulk add from a masterlist: check first (saves nothing), then import.
    Route::post('/intern-imports/preview', [CoordinatorMonitoringController::class, 'previewInternImport']);
    Route::post('/intern-imports', [CoordinatorMonitoringController::class, 'importInterns']);
    Route::patch('/interns/{deploymentId}', [CoordinatorMonitoringController::class, 'updateDeployment']);
    Route::patch('/interns/{deploymentId}/status', [CoordinatorMonitoringController::class, 'updateInternStatus']);
    Route::delete('/interns/{deploymentId}', [CoordinatorMonitoringController::class, 'destroyIntern']);
    Route::post('/interns/{deploymentId}/reassign', [CoordinatorMonitoringController::class, 'reassignIntern']);

    Route::get('/companies', [CoordinatorMonitoringController::class, 'companies']);
    Route::post('/companies', [CoordinatorMonitoringController::class, 'storeCompany']);
    Route::patch('/companies/{id}', [CoordinatorMonitoringController::class, 'updateCompany']);
    Route::get('/companies/{id}', [CoordinatorMonitoringController::class, 'companyDetail']);
    Route::delete('/companies/{id}', [CoordinatorMonitoringController::class, 'destroyCompany']);

    Route::get('/supervisors', [CoordinatorMonitoringController::class, 'supervisors']);
    Route::post('/supervisors', [CoordinatorMonitoringController::class, 'storeSupervisor']);
    Route::patch('/supervisors/{userId}', [CoordinatorMonitoringController::class, 'updateSupervisor']);
    Route::delete('/supervisors/{userId}', [CoordinatorMonitoringController::class, 'destroySupervisor']);

    // Works for either an intern or a supervisor still awaiting activation —
    // see CoordinatorMonitoringController::resendInvitation.
    Route::post('/users/{userId}/resend-invitation', [CoordinatorMonitoringController::class, 'resendInvitation']);
    Route::patch('/users/{userId}/email', [CoordinatorMonitoringController::class, 'updatePendingEmail']);

    Route::get('/school-settings', [CoordinatorMonitoringController::class, 'schoolSettings']);
    Route::patch('/school-settings', [CoordinatorMonitoringController::class, 'updateSchoolSettings']);

    // View-only — logging/approving attendance is the supervisor's job (see the
    // supervisor route group below), not the coordinator's.
    Route::get('/attendance/companies', [CoordinatorMonitoringController::class, 'attendanceCompanies']);
    Route::get('/attendance', [CoordinatorMonitoringController::class, 'attendance']);

    // Coordinator is view-only for tasks — a supervisor assigns and manages
    // the actual work (see the supervisor group below); the coordinator's
    // job is oversight across every company, not creating or editing tasks.
    Route::get('/tasks', [CoordinatorMonitoringController::class, 'tasks']);
    Route::get('/tasks/{id}', [CoordinatorMonitoringController::class, 'taskShow']);
    Route::post('/tasks/{taskId}/comments', [CoordinatorMonitoringController::class, 'storeTaskComment']);
    Route::post('/subtasks/{subtaskId}/comments', [CoordinatorMonitoringController::class, 'storeSubtaskComment']);

    Route::get('/documents', [CoordinatorMonitoringController::class, 'documents']);
    Route::post('/documents', [CoordinatorMonitoringController::class, 'storeDocument']);
    Route::patch('/documents/{id}', [CoordinatorMonitoringController::class, 'reviewDocument']);

    // Coordinator owns the rubric; the supervisor is the one who actually
    // sits with the intern and submits the evaluation (see the supervisor
    // group below) — same "coordinator sets the standard, supervisor rates
    // the day-to-day work" split as tasks and attendance.
    Route::get('/evaluation-criteria', [CoordinatorMonitoringController::class, 'evaluationCriteria']);
    Route::post('/evaluation-criteria', [CoordinatorMonitoringController::class, 'storeEvaluationCriterion']);
    Route::get('/evaluations', [CoordinatorMonitoringController::class, 'evaluations']);

    // A coordinator's direct line to the platform owner (billing, account,
    // bug reports) — deliberately separate from the peer messaging system
    // above; Super Admin is never a contact there (see MessageController).
    Route::get('/support-tickets', [CoordinatorSupportController::class, 'index']);
    Route::post('/support-tickets', [CoordinatorSupportController::class, 'store']);
    Route::get('/support-tickets/{id}', [CoordinatorSupportController::class, 'show']);
    Route::post('/support-tickets/{id}/reply', [CoordinatorSupportController::class, 'reply']);
});

Route::prefix('supervisor')->middleware(['auth:sanctum', 'role:supervisor'])->group(function () {
    // Always scoped server-side to deployments where supervisor_id is the
    // logged-in supervisor — never their whole school's roster.
    Route::get('/interns', [SupervisorMonitoringController::class, 'interns']);
    Route::get('/interns/{deploymentId}/portfolio', [SupervisorMonitoringController::class, 'internPortfolio']);

    Route::get('/attendance', [SupervisorMonitoringController::class, 'attendance']);
    Route::post('/attendance', [SupervisorMonitoringController::class, 'storeAttendance']);
    Route::patch('/attendance/{id}', [SupervisorMonitoringController::class, 'reviewAttendance']);

    Route::get('/activities', [SupervisorMonitoringController::class, 'activities']);
    Route::post('/activities/approve', [SupervisorMonitoringController::class, 'approveActivities']);
    Route::patch('/activities/{id}', [SupervisorMonitoringController::class, 'reviewActivity']);

    // Supervisor assigns work (individual or group) to the interns they
    // supervise and breaks it into subtasks — but never drags/edits a
    // subtask's status directly, that's the intern's own call once assigned
    // (see InternMonitoringController).
    Route::get('/tasks', [SupervisorMonitoringController::class, 'tasks']);
    Route::post('/tasks', [SupervisorMonitoringController::class, 'storeTask']);
    Route::get('/tasks/{id}', [SupervisorMonitoringController::class, 'taskShow']);
    Route::post('/tasks/{id}/evaluate', [SupervisorMonitoringController::class, 'evaluateTask']);
    Route::post('/tasks/{taskId}/subtasks', [SupervisorMonitoringController::class, 'storeSubtask']);
    Route::delete('/subtasks/{id}', [SupervisorMonitoringController::class, 'destroySubtask']);
    Route::post('/tasks/{taskId}/comments', [SupervisorMonitoringController::class, 'storeTaskComment']);
    Route::post('/subtasks/{subtaskId}/comments', [SupervisorMonitoringController::class, 'storeSubtaskComment']);

    // The formal periodic OJT evaluation (the school's printed rubric) — the
    // supervisor fills this in for interns they actually supervise. The
    // rubric itself (criteria) is still the coordinator's to define.
    Route::get('/evaluation-criteria', [SupervisorMonitoringController::class, 'evaluationCriteria']);
    Route::get('/evaluations', [SupervisorMonitoringController::class, 'evaluations']);
    Route::post('/evaluations', [SupervisorMonitoringController::class, 'storeEvaluation']);
    Route::post('/evaluations/manual', [SupervisorMonitoringController::class, 'storeManualEvaluation']);
});

Route::prefix('intern')->middleware(['auth:sanctum', 'role:intern'])->group(function () {
    // Always scoped server-side to the logged-in intern's own record — never
    // another intern's. Attendance is self-reported via selfie + GPS and
    // lands "approved" immediately — the stamp is the verification (see
    // InternMonitoringController).
    Route::get('/tasks', [InternMonitoringController::class, 'tasks']);
    Route::get('/tasks/{id}', [InternMonitoringController::class, 'taskShow']);
    Route::patch('/tasks/{id}', [InternMonitoringController::class, 'updateTask']);
    Route::post('/tasks/{id}/complete', [InternMonitoringController::class, 'completeTask']);
    Route::post('/tasks/{taskId}/subtasks', [InternMonitoringController::class, 'storeSubtask']);
    Route::patch('/subtasks/{id}', [InternMonitoringController::class, 'updateSubtask']);
    Route::post('/subtasks/{id}/complete', [InternMonitoringController::class, 'completeSubtask']);
    Route::post('/tasks/{taskId}/comments', [InternMonitoringController::class, 'storeTaskComment']);
    Route::post('/subtasks/{subtaskId}/comments', [InternMonitoringController::class, 'storeSubtaskComment']);
    Route::get('/attendance', [InternMonitoringController::class, 'attendance']);
    Route::get('/attendance/today', [InternMonitoringController::class, 'attendanceToday']);
    Route::post('/attendance/clock-in', [InternMonitoringController::class, 'clockIn']);
    Route::post('/attendance/clock-out', [InternMonitoringController::class, 'clockOut']);
    Route::get('/evaluations', [InternMonitoringController::class, 'evaluations']);
    Route::get('/profile-summary', [InternMonitoringController::class, 'profileSummary']);
    Route::get('/activities', [InternMonitoringController::class, 'activities']);
    Route::get('/activities/suggestions', [InternMonitoringController::class, 'activitySuggestions']);
    Route::post('/activities/polish-narrative', [InternMonitoringController::class, 'polishNarrative']);
    Route::post('/activities', [InternMonitoringController::class, 'storeActivity']);
    Route::patch('/activities/{id}', [InternMonitoringController::class, 'updateActivity']);
    Route::get('/documents', [InternMonitoringController::class, 'documents']);
    Route::post('/documents', [InternMonitoringController::class, 'storeDocument']);
    Route::get('/portfolio', [InternMonitoringController::class, 'portfolio']);
    Route::patch('/portfolio', [InternMonitoringController::class, 'updatePortfolio']);
    Route::post('/portfolio/items', [InternMonitoringController::class, 'storePortfolioItem']);
    Route::delete('/portfolio/items/{id}', [InternMonitoringController::class, 'destroyPortfolioItem']);
});

// Public endpoints — no auth required; coordinator accepts a school invitation
// using the one-time token itself as the credential, before any login exists.
// Delivery events (bounces) from the mail provider — verified by signature.
Route::post('/webhooks/resend', [\App\Http\Controllers\Api\ResendWebhookController::class, 'handle'])->middleware('throttle:120,1');
Route::get('/invitations/{token}', [InvitationController::class, 'show']);
Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept']);

