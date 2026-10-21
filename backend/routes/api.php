<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CoordinatorMonitoringController;
use App\Http\Controllers\Api\CourseRequirementController;
use App\Http\Controllers\Api\SchoolCourseController;
use App\Http\Controllers\Api\DeanSubscriptionController;
use App\Http\Controllers\Api\CoordinatorSupportController;
use App\Http\Controllers\Api\DeanController;
use App\Http\Controllers\Api\DeanMonitoringController;
use App\Http\Controllers\Api\CoordinatorFeedbackController;
use App\Http\Controllers\Api\InternMonitoringController;
use App\Http\Controllers\Api\NarrativeReportController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\EmailVerificationController;
use App\Http\Controllers\Api\SuperadminFullController;
use App\Http\Controllers\Api\SupervisorCertificateController;
use App\Http\Controllers\Api\SupervisorCompanyLocationController;
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

// Public — the contact address and version shown on the /terms and /privacy pages.
// The email is the Super Admin's `support_email` system setting.
Route::get('/legal', function () {
    return response()->json([
        'terms_version' => config('internova.terms_version'),
        'support_email' => \App\Models\Setting::value('support_email', 'support@internova.ai'),
    ]);
});

Route::prefix('superadmin')->middleware(['auth:sanctum', 'role:super_admin'])->group(function () {
    Route::get('/dashboard', [SuperadminFullController::class, 'dashboard']);

    Route::get('/schools', [SuperadminFullController::class, 'schools']);
    Route::get('/plan-inquiries', [SuperadminFullController::class, 'planInquiries']);
    Route::patch('/plan-inquiries/{id}', [SuperadminFullController::class, 'updateInquiry']);
    Route::post('/plan-inquiries/send-reply', [SuperadminFullController::class, 'sendReply']);
    Route::post('/plan-inquiries/{id}/convert-to-school', [SuperadminFullController::class, 'convertInquiryToSchool']);
    Route::post('/schools/{id}/confirm-payment', [SuperadminFullController::class, 'confirmSchoolPayment']);
    Route::post('/schools/{id}/verify-payment', [SuperadminFullController::class, 'verifySchoolPayment']);
    Route::get('/schools/{id}/receipts', [SuperadminFullController::class, 'schoolReceipts']);
    Route::get('/schools/{id}/receipts/{transaction}', [SuperadminFullController::class, 'schoolReceipt'])->whereNumber('transaction');
    Route::post('/schools/{id}/toggle-suspend', [SuperadminFullController::class, 'toggleSchoolSuspension']);
    Route::post('/schools/{id}/resend-offer', [SuperadminFullController::class, 'resendSchoolOffer']);
    Route::post('/schools/{id}/invite-dean', [SuperadminFullController::class, 'inviteDean']);
    Route::post('/schools/{id}/resend-dean-invitation', [SuperadminFullController::class, 'resendDeanInvitation']);
    Route::get('/revenue', [SuperadminFullController::class, 'revenue']);
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
Route::post('/inquiries', [SuperadminFullController::class, 'storeInquiry'])->middleware('throttle:inquiry');

// Public login — email + password against the users table
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth-login');

// Public — no auth required; proving control of the email IS the auth here
Route::post('/auth/forgot-password', [PasswordResetController::class, 'forgotPassword'])->middleware('throttle:auth-mail');
// Throttled (RateLimits.php) — a 6-digit code has only a million possibilities, so the
// verify/submit steps need a real rate limit, not just an expiry.
Route::post('/auth/verify-reset-code', [PasswordResetController::class, 'verifyResetCode'])->middleware('throttle:auth-code');
Route::post('/auth/reset-password', [PasswordResetController::class, 'resetPassword'])->middleware('throttle:auth-code');

// Public — gates login for self-registered (Inquiry form) accounts until
// the code emailed at signup is entered. See AuthController::login().
Route::post('/auth/verify-email', [EmailVerificationController::class, 'verify'])->middleware('throttle:auth-code');
Route::post('/auth/resend-verification', [EmailVerificationController::class, 'resend'])->middleware('throttle:auth-mail');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    // Throttled per user: a stolen token must not be able to guess the current password.
    Route::post('/auth/change-password', [AuthController::class, 'changePassword'])->middleware('throttle:6,1');
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
    Route::post('/notifications/seen', [NotificationController::class, 'markSeen']);
    // Live to-do list of the signed-in user (role/school/id come from the token, never from the request).
    Route::get('/notifications/attention', [NotificationController::class, 'attention']);

    // Chat belongs to a school, so it is closed with it (suspended / expired) like the role groups below.
    Route::middleware('school.active')->group(function () {
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
});

Route::prefix('coordinator')->middleware(['auth:sanctum', 'role:coordinator', 'school.active'])->group(function () {
    // Day-to-day internship monitoring — always scoped server-side to the
    // authenticated coordinator's own school (see CoordinatorMonitoringController).
    Route::get('/dashboard', [CoordinatorMonitoringController::class, 'dashboard']);
    Route::get('/interns', [CoordinatorMonitoringController::class, 'interns']);
    Route::get('/interns/{deploymentId}/portfolio', [CoordinatorMonitoringController::class, 'internPortfolio']);
    Route::get('/interns/{deploymentId}/report', [CoordinatorMonitoringController::class, 'internReport']);
    Route::get('/interns/{deploymentId}/narrative-report', [NarrativeReportController::class, 'coordinatorReport']);
    Route::get('/interns/{deploymentId}/narrative-report/docx', [NarrativeReportController::class, 'coordinatorDocx']);
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

    // School's narrative report template (letterhead + cover + logo; sections are Phase 2).
    Route::get('/narrative-template', [NarrativeReportController::class, 'showTemplate']);
    Route::patch('/narrative-template', [NarrativeReportController::class, 'updateTemplate']);
    Route::post('/narrative-template/logo', [NarrativeReportController::class, 'uploadLogo']);
    Route::delete('/narrative-template/logo', [NarrativeReportController::class, 'destroyLogo']);

    // Read-only for the coordinator — the Dean edits (see the dean group).
    Route::get('/school-settings', [CoordinatorMonitoringController::class, 'schoolSettings']);

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
    // Which documents each course must submit (set per school; see CourseRequirementService).
    Route::get('/course-requirements', [CourseRequirementController::class, 'index']);
    Route::put('/course-requirements', [CourseRequirementController::class, 'update']);
    Route::delete('/course-requirements', [CourseRequirementController::class, 'reset']);
    Route::post('/course-requirements/rename', [CourseRequirementController::class, 'rename']);
    Route::get('/document-types', [CourseRequirementController::class, 'forDeployment']);
    // Courses offered by the school (catalog + the school's pick); shared with the Dean below.
    Route::get('/school-courses', [SchoolCourseController::class, 'index']);
    Route::put('/school-courses', [SchoolCourseController::class, 'update']);

    // Coordinator owns the rubric; the supervisor is the one who actually
    // sits with the intern and submits the evaluation (see the supervisor
    // group below) — same "coordinator sets the standard, supervisor rates
    // the day-to-day work" split as tasks and attendance.
    Route::get('/evaluation-criteria', [CoordinatorMonitoringController::class, 'evaluationCriteria']);
    Route::post('/evaluation-criteria', [CoordinatorMonitoringController::class, 'storeEvaluationCriterion']);
    Route::patch('/evaluation-criteria/{id}', [CoordinatorMonitoringController::class, 'updateEvaluationCriterion']);
    Route::delete('/evaluation-criteria/{id}', [CoordinatorMonitoringController::class, 'destroyEvaluationCriterion']);
    Route::get('/evaluations', [CoordinatorMonitoringController::class, 'evaluations']);

    // A coordinator's direct line to the platform owner (billing, account,
    // bug reports) — deliberately separate from the peer messaging system
    // above; Super Admin is never a contact there (see MessageController).
    Route::get('/support-tickets', [CoordinatorSupportController::class, 'index'])->withoutMiddleware('school.active');
    Route::post('/support-tickets', [CoordinatorSupportController::class, 'store'])->withoutMiddleware('school.active');
    Route::get('/support-tickets/{id}', [CoordinatorSupportController::class, 'show'])->withoutMiddleware('school.active');
    Route::post('/support-tickets/{id}/reply', [CoordinatorSupportController::class, 'reply'])->withoutMiddleware('school.active');

    // Feedback the Dean sends (read-only for the coordinator).
    Route::get('/feedback', [CoordinatorFeedbackController::class, 'index']);
    Route::get('/feedback/unread-count', [CoordinatorFeedbackController::class, 'unreadCount']);
    Route::post('/feedback/read-all', [CoordinatorFeedbackController::class, 'markAllRead']);
    Route::post('/feedback/{id}/read', [CoordinatorFeedbackController::class, 'markRead']);
    Route::post('/feedback/{id}/acknowledge', [CoordinatorFeedbackController::class, 'acknowledge']);
    Route::post('/feedback/{id}/reply', [CoordinatorFeedbackController::class, 'reply']);
});

// The school's Dean / Principal: billing owner, school settings, and the
// school's single coordinator. Billing routes also require that the school id
// in the URL is the dean's own school (dean.school).
Route::prefix('dean')->middleware(['auth:sanctum', 'role:dean', 'school.active'])->group(function () {
    // Billing stays reachable when the school is suspended / expired: it is how the Dean renews and pays.
    Route::middleware('dean.school')->withoutMiddleware('school.active')->group(function () {
        Route::post('/schools/{id}/accept-offer', [DeanSubscriptionController::class, 'acceptOffer']);
        Route::post('/schools/{id}/checkout', [DeanSubscriptionController::class, 'checkout']);
        Route::post('/schools/{id}/verify-checkout', [DeanSubscriptionController::class, 'verifyCheckout']);
        Route::post('/schools/{id}/renew', [DeanSubscriptionController::class, 'renew']);
        Route::post('/schools/{id}/request-new-offer', [DeanSubscriptionController::class, 'requestNewOffer']);
        Route::post('/schools/{id}/upload-proof', [DeanSubscriptionController::class, 'uploadProof']);
        Route::post('/schools/{id}/switch-plan', [DeanSubscriptionController::class, 'switchPlan']);
        Route::post('/schools/{id}/cancel-scheduled-switch', [DeanSubscriptionController::class, 'cancelScheduledSwitch']);
        Route::post('/schools/{id}/upgrade-plan', [DeanSubscriptionController::class, 'requestUpgrade']);
        Route::post('/schools/{id}/cancel-pending-upgrade', [DeanSubscriptionController::class, 'cancelPendingUpgrade']);
        Route::get('/schools/{id}/upgrade-quote', [DeanSubscriptionController::class, 'upgradeQuote']);
        Route::post('/schools/{id}/request-plan-change', [DeanSubscriptionController::class, 'requestPlanChange']);
        Route::get('/schools/{id}/receipts', [DeanSubscriptionController::class, 'receipts']);
        Route::get('/schools/{id}/receipts/{transaction}', [DeanSubscriptionController::class, 'receipt'])->whereNumber('transaction');
    });

    Route::get('/dashboard', [DeanController::class, 'dashboard']);

    // Monitoring (read-only) — see DeanMonitoringController.
    Route::get('/overview', [DeanMonitoringController::class, 'overview']);
    Route::get('/coordinator/profile', [DeanMonitoringController::class, 'coordinatorProfile']);
    Route::get('/coordinator/activity', [DeanMonitoringController::class, 'coordinatorActivity']);
    Route::get('/coordinator/pending', [DeanMonitoringController::class, 'coordinatorPending']);
    Route::get('/coordinator/feedback', [DeanMonitoringController::class, 'feedbackIndex']);
    Route::post('/coordinator/feedback', [DeanMonitoringController::class, 'feedbackStore']);
    Route::get('/coordinator/feedback/unread-count', [DeanMonitoringController::class, 'feedbackUnreadCount']);
    Route::post('/coordinator/feedback/read-all', [DeanMonitoringController::class, 'feedbackReadAll']);
    Route::post('/coordinator/feedback/{id}/reply', [DeanMonitoringController::class, 'feedbackReply']);
    Route::post('/coordinator/feedback/{id}/resolve', [DeanMonitoringController::class, 'feedbackResolve']);
    Route::post('/coordinator/feedback/{id}/reopen', [DeanMonitoringController::class, 'feedbackReopen']);
    Route::get('/coordinator/insights', [DeanMonitoringController::class, 'coordinatorInsights']);
    Route::get('/report/docx', [DeanMonitoringController::class, 'schoolReportDocx']);
    Route::get('/preferences', [DeanController::class, 'preferences']);
    Route::patch('/preferences', [DeanController::class, 'updatePreferences']);
    Route::patch('/head-title', [DeanController::class, 'updateHeadTitle']);
    Route::get('/interns', [DeanMonitoringController::class, 'interns']);
    Route::get('/interns/{deploymentId}', [DeanMonitoringController::class, 'internDetail']);
    Route::get('/interns/{deploymentId}/narrative-report', [DeanMonitoringController::class, 'narrativeReport']);
    Route::get('/interns/{deploymentId}/narrative-report/docx', [DeanMonitoringController::class, 'narrativeDocx']);

    Route::get('/coordinator', [DeanController::class, 'coordinator']);
    Route::post('/coordinator/invite', [DeanController::class, 'inviteCoordinator']);
    Route::post('/coordinator/resend-invitation', [DeanController::class, 'resendCoordinatorInvitation']);
    Route::patch('/coordinator/email', [DeanController::class, 'updateCoordinatorEmail']);
    Route::post('/coordinator/deactivate', [DeanController::class, 'deactivateCoordinator']);

    Route::get('/school-settings', [DeanController::class, 'schoolSettings']);
    Route::patch('/school-settings', [DeanController::class, 'updateSchoolSettings']);
    Route::get('/school-courses', [SchoolCourseController::class, 'index']);
    Route::put('/school-courses', [SchoolCourseController::class, 'update']);

    // Same direct line to the platform owner coordinators have.
    Route::get('/support-tickets', [CoordinatorSupportController::class, 'index'])->withoutMiddleware('school.active');
    Route::post('/support-tickets', [CoordinatorSupportController::class, 'store'])->withoutMiddleware('school.active');
    Route::get('/support-tickets/{id}', [CoordinatorSupportController::class, 'show'])->withoutMiddleware('school.active');
    Route::post('/support-tickets/{id}/reply', [CoordinatorSupportController::class, 'reply'])->withoutMiddleware('school.active');
});

Route::prefix('supervisor')->middleware(['auth:sanctum', 'role:supervisor', 'school.active'])->group(function () {
    // Always scoped server-side to deployments at the supervisor's company (InternshipDeployment::visibleToSupervisor) — never their
    // whole school's roster; both supervisors of a company share their interns.
    Route::get('/dashboard', [SupervisorMonitoringController::class, 'dashboard']);
    Route::get('/interns', [SupervisorMonitoringController::class, 'interns']);
    Route::get('/interns/{deploymentId}/portfolio', [SupervisorMonitoringController::class, 'internPortfolio']);

    // How this company records attendance (one time in/out, or morning and afternoon).
    // The company's map pin and radius: set only by its supervisors, read-only for everyone else.
    Route::get('/company-location', [SupervisorCompanyLocationController::class, 'show']);
    Route::put('/company-location', [SupervisorCompanyLocationController::class, 'update']);
    Route::get('/attendance-settings', [SupervisorMonitoringController::class, 'attendanceSettings']);
    Route::put('/attendance-settings', [SupervisorMonitoringController::class, 'updateAttendanceSettings']);
    Route::get('/attendance', [SupervisorMonitoringController::class, 'attendance']);
    Route::post('/attendance', [SupervisorMonitoringController::class, 'storeAttendance']);
    Route::patch('/attendance/{id}', [SupervisorMonitoringController::class, 'reviewAttendance']);
    Route::patch('/attendance/{id}/times', [SupervisorMonitoringController::class, 'updateAttendanceTimes']);
    Route::delete('/attendance/{id}', [SupervisorMonitoringController::class, 'destroyAttendance']);
    Route::patch('/attendance/{id}/red-flag', [SupervisorMonitoringController::class, 'checkRedFlag']);

    // OJT certificate of completion: one PowerPoint template per company, filled in per intern.
    Route::get('/certificates', [SupervisorCertificateController::class, 'show']);
    Route::post('/certificates/template', [SupervisorCertificateController::class, 'upload']);
    Route::delete('/certificates/template', [SupervisorCertificateController::class, 'destroy']);
    Route::get('/certificates/sample', [SupervisorCertificateController::class, 'sample']);
    Route::post('/certificates/generate', [SupervisorCertificateController::class, 'generate']);

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
    Route::patch('/tasks/{id}', [SupervisorMonitoringController::class, 'updateTask']);
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
    Route::patch('/evaluations/{id}', [SupervisorMonitoringController::class, 'updateEvaluation']);
});

Route::prefix('intern')->middleware(['auth:sanctum', 'role:intern', 'school.active'])->group(function () {
    // Always scoped server-side to the logged-in intern's own record — never
    // another intern's. Attendance is self-reported via selfie + GPS and
    // lands "approved" immediately — the stamp is the verification (see
    // InternMonitoringController).
    Route::get('/dashboard', [InternMonitoringController::class, 'dashboard']);
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
    Route::get('/document-types', [CourseRequirementController::class, 'forIntern']);
    Route::get('/portfolio', [InternMonitoringController::class, 'portfolio']);
    Route::patch('/portfolio', [InternMonitoringController::class, 'updatePortfolio']);
    Route::get('/portfolio/narrative-report', [NarrativeReportController::class, 'internReport']);
    Route::get('/portfolio/narrative-report/docx', [NarrativeReportController::class, 'internDocx']);
    Route::post('/portfolio/items', [InternMonitoringController::class, 'storePortfolioItem']);
    Route::delete('/portfolio/items/{id}', [InternMonitoringController::class, 'destroyPortfolioItem']);
});

// Public endpoints — no auth required; coordinator accepts a school invitation
// using the one-time token itself as the credential, before any login exists.
// Delivery events (bounces) from the mail provider — verified by signature.
Route::post('/webhooks/resend', [\App\Http\Controllers\Api\ResendWebhookController::class, 'handle'])->middleware('throttle:120,1');
// PayMongo payment events - no login or CSRF, the Paymongo-Signature header is the credential.
Route::post('/webhooks/paymongo', [\App\Http\Controllers\Api\PayMongoWebhookController::class, 'handle'])->middleware('throttle:120,1');
Route::get('/invitations/{token}', [InvitationController::class, 'show'])->middleware('throttle:invitation');
Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept'])->middleware('throttle:invitation');

