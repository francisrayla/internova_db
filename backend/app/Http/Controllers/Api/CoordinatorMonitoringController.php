<?php

namespace App\Http\Controllers\Api;

use App\Support\Courses;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\DeploymentTransfer;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\EvaluationCriterion;
use App\Models\EvaluationScore;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Portfolio;
use App\Models\Role;
use App\Models\School;
use App\Models\Subtask;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\TaskProof;
use App\Models\User;
use App\Rules\CompleteEmail;
use App\Services\AccountInvitationService;
use App\Services\ActivityLogService;
use App\Services\DashboardQueueService;
use App\Services\DeploymentHistoryService;
use App\Services\DeploymentSummaryService;
use App\Services\EmailDeliverability;
use App\Services\InternMonitoringService;
use App\Services\PlanFeatures;
use App\Services\SchoolCourseService;
use App\Services\NotificationService;
use App\Support\Paging;
use App\Support\TaskListing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Day-to-day internship monitoring for a coordinator: interns under their
 * school's active deployments, attendance, tasks, documents, and
 * evaluations. Every query is scoped to $request->user()->school_id — a
 * coordinator's token never grants access to another school's records.
 */
class CoordinatorMonitoringController extends Controller
{
    private function deploymentIdsForSchool(int $schoolId): array
    {
        return InternshipDeployment::where('school_id', $schoolId)->pluck('id')->all();
    }

    /**
     * Loads a deployment and 404s (via the caller) if it doesn't belong to
     * this coordinator's school — the authorization check every mutating
     * endpoint below needs before touching a deployment-scoped record.
     */
    private function deploymentForSchool(int $deploymentId, int $schoolId): ?InternshipDeployment
    {
        return InternshipDeployment::where('id', $deploymentId)->where('school_id', $schoolId)->first();
    }

    // ---------------------------------------------------------------
    // School settings — read-only here. Editing the school's details belongs
    // to the school's Dean (see DeanController::updateSchoolSettings).
    // ---------------------------------------------------------------

    public function schoolSettings(Request $request): JsonResponse
    {
        $school = School::find($request->user()->school_id);
        if (!$school) {
            return response()->json(['success' => false, 'message' => 'School not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'school'  => [
                'school_name'    => $school->school_name,
                'address'        => $school->address,
                'contact_email'  => $school->contact_email,
                'contact_number' => $school->contact_number,
                'status'         => $school->status,
            ],
        ]);
    }

    /**
     * Sends a real "set your own password" invitation instead of the
     * coordinator choosing a password on the recipient's behalf — see
     * AccountInvitationService (shared with the Dean's coordinator invite).
     */
    private function sendAccountInvitation(User $user, string $roleLabel, string $contextLabel, User $coordinator, ?int $delaySeconds = null): void
    {
        AccountInvitationService::send(
            $user,
            $roleLabel,
            $contextLabel,
            trim("{$coordinator->first_name} {$coordinator->last_name}") ?: $coordinator->name,
            $coordinator->email,
            $delaySeconds
        );
    }

    /** Lowercases and strips spaces from an email field (when sent) so what is validated is what is saved. */
    private function normalizeEmailInput(Request $request, string $field = 'email'): void
    {
        if ($request->has($field) && is_string($request->input($field))) {
            $value = CompleteEmail::normalize($request->input($field));
            // An empty optional field is "no email", not an invalid one.
            $request->merge([$field => $value === '' ? null : $value]);
        }
    }

    /**
     * The recovery path a coordinator otherwise doesn't have: if an invite
     * never arrives (spam, a mistyped inbox, or the original send simply
     * failing) there was previously no way to get that supervisor/intern a
     * fresh link short of deleting and recreating the account. Re-issues a
     * brand-new token (invalidating any old one) and re-queues the email —
     * works for either role, since both are invited the same way.
     */
    public function resendInvitation(Request $request, int $userId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $user = User::where('id', $userId)->where('school_id', $schoolId)->first();

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found for your school.'], 404);
        }
        if ($user->status !== 'pending_activation') {
            return response()->json(['success' => false, 'message' => 'This account has already been activated.'], 422);
        }

        $roleName = $user->roles?->name;

        if ($roleName === 'supervisor') {
            $roleLabel = 'Supervisor';
            $profile = SupervisorProfile::where('user_id', $user->id)->first();
            $company = $profile ? Company::find($profile->company_id) : null;
        } elseif ($roleName === 'intern') {
            $roleLabel = 'Intern';
            $company = InternshipDeployment::where('intern_id', $user->id)->latest('id')->first()?->company;
        } else {
            return response()->json(['success' => false, 'message' => 'This account type cannot be re-invited from here.'], 422);
        }

        $this->sendAccountInvitation($user, $roleLabel, $company ? "at {$company->company_name}" : '', $request->user());

        ActivityLogService::record(
            module: $roleName === 'supervisor' ? 'Companies' : 'Interns',
            action: 'Resent invitation',
            description: "{$user->name}'s invitation email was resent.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Invitation resent.']);
    }

    /**
     * Fixes the email of an invited intern or supervisor who hasn't activated
     * yet — typically after their invitation bounced — and sends the
     * invitation again to the corrected address.
     */
    public function updatePendingEmail(Request $request, int $userId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $user = User::where('id', $userId)->where('school_id', $schoolId)->first();

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found for your school.'], 404);
        }
        if ($user->status !== 'pending_activation') {
            return response()->json(['success' => false, 'message' => 'This account is already active — the owner can change their own email.'], 422);
        }
        if (!in_array($user->roles?->name, ['supervisor', 'intern'], true)) {
            return response()->json(['success' => false, 'message' => 'This account type cannot be edited from here.'], 422);
        }

        $request->merge(['email' => CompleteEmail::normalize($request->input('email'))]);
        $data = $request->validate([
            'email' => ['required', 'bail', new CompleteEmail, Rule::unique('users', 'email')->ignore($user->id)],
        ]);

        $old = $user->email;
        $user->update(['email' => $data['email'], 'email_bounced_at' => null, 'email_bounce_reason' => null]);

        $response = $this->resendInvitation($request, $userId);

        ActivityLogService::record(
            module: $user->roles?->name === 'supervisor' ? 'Companies' : 'Interns',
            action: 'Corrected invitation email',
            description: "{$user->name}'s email changed from {$old} to {$data['email']} and the invitation was resent.",
            schoolId: $schoolId,
            request: $request
        );

        return $response;
    }

    // ---------------------------------------------------------------
    // Interns
    // ---------------------------------------------------------------

    /**
     * Dashboard data. The tiles come from the SAME rows and summary as the Interns page, so the numbers on the
     * two screens cannot disagree; the queue is the "needs attention" list (DashboardQueueService).
     */
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->where('school_id', $user->school_id)->orderByDesc('id')->get();
        $interns = $this->internRows($user->school_id, $deployments);

        return response()->json([
            'summary' => $this->internSummary($interns),
            'queue' => DashboardQueueService::coordinator($user, $interns),
        ]);
    }

    /** The coordinator's "needs attention" list for the bell: their own school only (from the signed-in user). */
    public function attentionQueue(User $user): array
    {
        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->where('school_id', $user->school_id)->orderByDesc('id')->get();

        return DashboardQueueService::coordinator($user, $this->internRows($user->school_id, $deployments));
    }

    public function interns(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->where('school_id', $schoolId)
            ->orderByDesc('id')
            ->get();

        $interns = $this->internRows($schoolId, $deployments);

        // Opt-in paging (the dashboard, pending list etc. still read everything). The summary and
        // the dropdown options always describe the whole list; filters and search narrow it BEFORE it is cut into pages.
        if (Paging::requested($request)) {
            return response()->json($this->pagedInterns($request, $interns));
        }

        return response()->json([
            'interns' => $interns->values(),
            'summary' => $this->internSummary($interns),
        ]);
    }

    /**
     * scope = roster (not archived) | archive (inactive) | anything else = every row.
     * filter = all (account set up) | active | completed | needs_attention. Also search, company (name), company_id, course.
     */
    private function pagedInterns(Request $request, $interns): array
    {
        $scoped = match ($request->query('scope')) {
            'roster' => $interns->filter(fn ($i) => $i['status'] !== 'inactive'),
            'archive' => $interns->filter(fn ($i) => $i['status'] === 'inactive'),
            default => $interns,
        };
        $scoped = $scoped->values();

        $options = [
            'companies' => $scoped->pluck('company_name')->filter()->unique()->sort()->values(),
            'courses' => $scoped->pluck('course')->filter()->unique()->sort()->values(),
        ];

        $rows = $scoped;
        if ($filter = $request->query('filter')) {
            $rows = $rows->filter(fn ($i) => match ($filter) {
                'all' => $i['display_status'] !== 'invitation_pending',
                'needs_attention' => count($i['attention'] ?? []) > 0,
                default => $i['display_status'] === $filter,
            });
        }
        if ($company = $request->query('company')) {
            $rows = $rows->filter(fn ($i) => $i['company_name'] === $company);
        }
        if ($companyId = $request->query('company_id')) {
            $rows = $rows->filter(fn ($i) => (string) $i['company_id'] === (string) $companyId);
        }
        if ($course = $request->query('course')) {
            $course = Courses::canonical($course);
            $rows = $rows->filter(fn ($i) => Courses::canonical($i['course']) === $course);
        }
        if (($q = mb_strtolower(trim((string) $request->query('search')))) !== '') {
            $rows = $rows->filter(function ($i) use ($q) {
                foreach (['intern_name', 'company_name', 'student_number', 'supervisor_name'] as $key) {
                    if (isset($i[$key]) && str_contains(mb_strtolower((string) $i[$key]), $q)) {
                        return true;
                    }
                }

                return false;
            });
        }

        $page = Paging::collection($rows->values(), $request, 15, 50);

        return [
            'interns' => collect($page->items())->values(),
            ...Paging::meta($page),
            'summary' => $this->internSummary($interns),
            'options' => $options,
        ];
    }

    /**
     * The standard intern row (DeploymentSummaryService) plus the friendly
     * extras the coordinator screens show: display_status, attention chips and
     * last clock-in. Attention reuses InternMonitoringService (the Dean's
     * rules) in one batched pass, so it is a fixed number of extra queries.
     */
    private function internRows(int $schoolId, $deployments)
    {
        $profiles = InternProfile::where('school_id', $schoolId)->get()->keyBy('user_id');
        $school = $deployments->isEmpty() ? null : School::find($schoolId);
        $monitor = $school ? InternMonitoringService::rows($school)->keyBy('deployment_id') : collect();

        $movedFrom = DeploymentHistoryService::movedFrom($deployments);

        return $deployments->map(function (InternshipDeployment $d) use ($profiles, $monitor, $movedFrom) {
            $row = DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id));
            $pending = $row['account_status'] === 'pending_activation';
            $m = $monitor->get($d->id);

            $row['invitation_expired'] = $pending && $d->intern?->invitation_expires_at !== null && \Illuminate\Support\Carbon::parse($d->intern->invitation_expires_at)->isPast();
            $attention = [];
            // Only interns still working: a finished intern has nothing left to clock in or catch up on.
            if ($row['display_status'] === 'active') {
                if (!$d->supervisorNames()) {
                    $attention[] = ['key' => 'no_supervisor', 'label' => 'No supervisor yet'];
                }
                foreach ($m['flags'] ?? [] as $f) {
                    if ($f['key'] === 'no_clock_in') {
                        $attention[] = ['key' => 'no_clock_in', 'label' => $f['label']];
                    } elseif ($f['key'] === 'behind_hours') {
                        $attention[] = ['key' => 'behind_hours', 'label' => 'Behind on hours', 'detail' => $f['label']];
                    }
                }
            }
            $row['attention'] = $attention;
            $row['last_clock_in_at'] = $m['last_clock_in_at'] ?? null;
            $moved = $movedFrom[$d->id] ?? null;
            $row['moved_from'] = $moved['company_name'] ?? null;
            $row['moved_on'] = $moved['transferred_on'] ?? null;

            return $row;
        });
    }

    private function internSummary($interns): array
    {
        // active = still working with an account; completed = finished (hours rendered or marked completed);
        // on_list = what the Interns page shows under "All" (not archived, account set up).
        $stats = DeploymentSummaryService::stats($interns);

        return [
            'active' => $stats['active'],
            'invitation_pending' => $stats['pending_accounts'],
            'needs_attention' => $interns->filter(fn ($r) => count($r['attention']) > 0)->count(),
            'completed' => $stats['completed'],
            'total' => $interns->where('display_status', '!=', 'inactive')->count(),
            'on_list' => $stats['on_list'],
            'average_hours_pct' => $stats['average_hours_pct'],
        ];
    }

    /**
     * Read-only, same as the supervisor's version — a coordinator never
     * edits an intern's portfolio, only views what's already there.
     */
    public function internPortfolio(Request $request, int $deploymentId): JsonResponse
    {
        $deployment = $this->deploymentForSchool($deploymentId, $request->user()->school_id);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found.'], 404);
        }

        $portfolio = Portfolio::with('items')->where('intern_id', $deployment->intern_id)->first();

        return response()->json([
            'intern_name' => trim("{$deployment->intern?->first_name} {$deployment->intern?->last_name}") ?: $deployment->intern?->name,
            'portfolio' => $portfolio?->present(),
        ]);
    }

    // ---------------------------------------------------------------
    // Attendance — coordinators can only view. Logging/approving belongs to
    // the intern's supervisor (see SupervisorMonitoringController) — a
    // coordinator wasn't there to see whether the intern actually showed up.
    // ---------------------------------------------------------------

    private function filteredAttendanceQuery(Request $request)
    {
        $query = Attendance::whereIn('deployment_id', $this->deploymentIdsForSchool($request->user()->school_id));

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }
        if ($companyId = $request->query('company_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('company_id', $companyId));
        }
        // By first name, last name or the full name ("First Last").
        $query->internNameLike($request->query('search'));
        if ($from = $request->query('from')) {
            $query->whereDate('attendance_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('attendance_date', '<=', $to);
        }

        return $query;
    }

    public function attendanceCompanies(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $companies = Company::whereIn('id', InternshipDeployment::where('school_id', $schoolId)->pluck('company_id'))
            ->orderBy('company_name')
            ->get(['id', 'company_name'])
            ->map(function ($c) use ($request) {
                $scoped = $this->filteredAttendanceQuery($request)
                    ->whereHas('deployment', fn ($q) => $q->where('company_id', $c->id));

                return ['id' => $c->id, 'name' => $c->company_name, 'total' => $scoped->count()];
            })
            ->values();

        return response()->json(['companies' => $companies]);
    }

    public function attendance(Request $request): JsonResponse
    {
        $records = $this->filteredAttendanceQuery($request)
            ->with('deployment.intern', 'deployment.company', 'redFlagChecker')
            ->orderByDesc('attendance_date')
            ->paginate(10);

        return response()->json([
            'last_page' => $records->lastPage(),
            'records' => collect($records->items())->map(fn (Attendance $a) => [
                'id' => $a->id,
                'deployment_id' => $a->deployment_id,
                'intern_name' => trim("{$a->deployment?->intern?->first_name} {$a->deployment?->intern?->last_name}") ?: $a->deployment?->intern?->name,
                'company_name' => $a->deployment?->company?->company_name,
                'clock_in_selfie_url' => $a->clock_in_selfie_path ? Storage::disk('public')->url($a->clock_in_selfie_path) : null,
                'clock_out_selfie_url' => $a->clock_out_selfie_path ? Storage::disk('public')->url($a->clock_out_selfie_path) : null,
                'auto_clocked_out' => (bool) $a->auto_clocked_out,
                'edited' => $a->edited_at !== null,
                'clock_in_is_offline' => (bool) $a->clock_in_is_offline,
                'clock_out_is_offline' => (bool) $a->clock_out_is_offline,
                'clock_in_distance_m' => $a->clock_in_distance_m,
                'clock_out_distance_m' => $a->clock_out_distance_m,
                'location_flags' => array_values(array_unique([...($a->clock_in_location_flags ?? []), ...($a->clock_out_location_flags ?? [])])),
                ...$a->redFlagPayload(),
                'attendance_date' => $a->attendance_date?->format('M d, Y'),
                'session' => $a->session ?: Attendance::FULL,
                'session_label' => match ($a->session) { Attendance::AM => 'Morning', Attendance::PM => 'Afternoon', default => null },
                'clock_in' => $a->clock_in?->local()?->format('h:i A'),
                'clock_out' => $a->clock_out?->local()?->format('h:i A'),
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
                'status' => $a->status,
            ]),
            'total' => $records->total(),
            'page' => $records->currentPage(),
            'has_more' => $records->hasMorePages(),
        ]);
    }

    // ---------------------------------------------------------------
    // Tasks
    // ---------------------------------------------------------------

    /**
     * Coordinators are view-only for tasks — a supervisor assigns and
     * manages the actual work (see SupervisorMonitoringController), since
     * they're the one on-site who knows what needs doing. The coordinator's
     * job here is oversight across every company their interns are
     * deployed to, so tasks are always scoped and shown per-company rather
     * than as one undifferentiated list.
     */
    public function tasks(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $query = Task::with(['company', 'assignees.user', 'subtasks', 'evaluation'])
            ->whereHas('company', fn ($q) => $q->where('school_id', $schoolId))
            ->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($companyId = $request->query('company_id')) {
            $query->where('company_id', $companyId);
        }

        $companies = Company::where('school_id', $schoolId)->orderBy('company_name')->get(['id', 'company_name']);

        // ?view=summary: only the per-company figures (company list, dashboard) — no task rows at all.
        if ($request->query('view') === 'summary') {
            $ratings = $this->ratingsEnabled();
            $scoped = fn () => Task::whereHas('company', fn ($q) => $q->where('school_id', $schoolId));
            $total = $scoped()->selectRaw('company_id, count(*) as c')->groupBy('company_id')->pluck('c', 'company_id');
            $done = $scoped()->where('status', 'completed')->selectRaw('company_id, count(*) as c')->groupBy('company_id')->pluck('c', 'company_id');
            $active = $scoped()->notInHistory($ratings)->selectRaw('company_id, count(*) as c')->groupBy('company_id')->pluck('c', 'company_id');

            return response()->json(['companies' => $companies->map(fn ($c) => [
                'id' => $c->id,
                'company_name' => $c->company_name,
                'total' => (int) ($total[$c->id] ?? 0),
                'active' => (int) ($active[$c->id] ?? 0),
                'completed' => (int) ($done[$c->id] ?? 0),
            ])->values()]);
        }

        // ?view=active (open work, whole) or ?view=history (finished and rated, paged); no view = every task.
        if ($listed = TaskListing::respond($request, $query, $this->ratingsEnabled(), fn (Task $t) => $this->mapTaskRow($t))) {
            return response()->json($listed + ['companies' => $companies]);
        }

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t));

        return response()->json(['tasks' => $tasks, 'companies' => $companies]);
    }

    private function mapTaskRow(Task $t): array
    {
        $assignees = $t->assignees->map(fn (TaskAssignee $a) => [
            'deployment_id' => $a->deployment_id,
            'user_id' => $a->user_id,
            'name' => trim("{$a->user?->first_name} {$a->user?->last_name}") ?: $a->user?->name,
        ]);

        return [
            'id' => $t->id,
            'company_id' => $t->company_id,
            'company_name' => $t->company?->company_name,
            'assignees' => $assignees,
            'is_group' => $assignees->count() > 1,
            'leader_id' => $t->leader_id,
            'title' => $t->title,
            'description' => $t->description,
            'priority' => $t->priority,
            'status' => $t->status,
            'due_date' => $t->due_date?->format('M d, Y'),
            'due_date_raw' => $t->due_date?->format('Y-m-d'),
            'created_at' => $t->created_at->local()->format('M d, Y'),
            'completed_at' => $t->completed_at?->local()?->format('M d, Y'),
            // Done but not graded yet: stays in the Active list until the supervisor rates it.
            'awaiting_rating' => $t->awaitingRating($this->ratingsEnabled()),
            'evaluation' => $t->evaluation ? [
                'rating' => (float) $t->evaluation->rating,
                'comments' => $t->evaluation->comments,
                'evaluated_at' => $t->evaluation->evaluated_at?->local()?->format('M d, Y'),
            ] : null,
            'subtask_total' => $t->subtasks->count(),
            'subtask_done' => $t->subtasks->where('status', 'completed')->count(),
        ];
    }

    private ?bool $ratingsEnabled = null;

    /** Does this school's plan include per-task ratings? (decides whether a done task waits for a grade) */
    private function ratingsEnabled(): bool
    {
        return $this->ratingsEnabled ??= PlanFeatures::has(request()->user()?->school, PlanFeatures::TASK_RATINGS);
    }

    /**
     * Loads a task and 404s (via the caller) if it doesn't belong to a
     * company in this coordinator's school.
     */
    private function taskForSchool(int $taskId, int $schoolId): ?Task
    {
        return Task::whereHas('company', fn ($q) => $q->where('school_id', $schoolId))->find($taskId);
    }

    public function taskShow(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $task = $this->taskForSchool($id, $schoolId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $task->load(['company', 'assignedBy', 'assignees.user', 'subtasks.assignees', 'subtasks.comments.user', 'subtasks.proofs.uploader', 'comments.user', 'evaluation', 'proofs.uploader']);

        return response()->json(['task' => $this->mapTaskDetail($task)]);
    }

    private function mapTaskDetail(Task $t): array
    {
        return [
            ...$this->mapTaskRow($t),
            'assigned_by_name' => $t->assignedBy?->name,
            'comments' => $t->comments->map(fn (TaskComment $c) => $this->mapComment($c)),
            'proofs' => $t->proofs->map(fn (TaskProof $p) => $this->mapProof($p)),
            'subtasks' => $t->subtasks->map(fn (Subtask $s) => [
                'id' => $s->id,
                'title' => $s->title,
                'description' => $s->description,
                'status' => $s->status,
                'due_date' => $s->due_date?->format('M d, Y'),
                'due_date_raw' => $s->due_date?->format('Y-m-d'),
                'assignees' => $this->mapSubtaskAssignees($s),
                'comments' => $s->comments->map(fn (TaskComment $c) => $this->mapComment($c)),
                'proofs' => $s->proofs->map(fn (TaskProof $p) => $this->mapProof($p)),
            ]),
        ];
    }

    private function mapSubtaskAssignees(Subtask $s): array
    {
        return $s->assignees->map(fn ($u) => [
            'user_id' => $u->id,
            'name' => trim("{$u->first_name} {$u->last_name}") ?: $u->name,
        ])->values()->all();
    }

    private function mapProof(TaskProof $p): array
    {
        return [
            'id' => $p->id,
            'file_name' => $p->file_name,
            'file_url' => Storage::disk('public')->url($p->file_path),
            'mime_type' => $p->mime_type,
            'uploaded_by_name' => trim("{$p->uploader?->first_name} {$p->uploader?->last_name}") ?: $p->uploader?->name,
            'created_at' => $p->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    private function mapComment(TaskComment $c): array
    {
        return [
            'id' => $c->id,
            'comment' => $c->comment,
            'author_name' => $c->user?->name,
            'created_at' => $c->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    private function subtaskForSchool(int $subtaskId, int $schoolId): ?Subtask
    {
        return Subtask::whereHas('task.company', fn ($q) => $q->where('school_id', $schoolId))->find($subtaskId);
    }

    public function storeTaskComment(Request $request, int $taskId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $task = $this->taskForSchool($taskId, $schoolId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $data = $request->validate(['comment' => 'required|string|max:2000']);

        $comment = $task->comments()->create([
            'user_id' => $request->user()->id,
            'comment' => $data['comment'],
        ]);
        $comment->load('user');

        ActivityLogService::record(
            module: 'Tasks',
            action: 'Commented on a task',
            description: "Commented on the task \"{$task->title}\".",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    public function storeSubtaskComment(Request $request, int $subtaskId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $subtask = $this->subtaskForSchool($subtaskId, $schoolId);
        if (!$subtask) {
            return response()->json(['success' => false, 'message' => 'Subtask not found.'], 404);
        }

        $data = $request->validate(['comment' => 'required|string|max:2000']);

        $comment = $subtask->comments()->create([
            'task_id' => $subtask->task_id,
            'user_id' => $request->user()->id,
            'comment' => $data['comment'],
        ]);
        $comment->load('user');

        ActivityLogService::record(
            module: 'Tasks',
            action: 'Commented on a subtask',
            description: "Commented on the subtask \"{$subtask->title}\".",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    // ---------------------------------------------------------------
    // Documents
    // ---------------------------------------------------------------

    public function documents(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deploymentIds = $this->deploymentIdsForSchool($schoolId);

        $query = Document::with('deployment.intern')->whereIn('deployment_id', $deploymentIds)->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        Paging::internNameLike($query, $request->query('search'));

        $page = $query->paginate(Paging::perPage($request, 20, 50));

        $documents = collect($page->items())->map(fn (Document $d) => [
            'id' => $d->id,
            'deployment_id' => $d->deployment_id,
            'intern_name' => trim("{$d->deployment?->intern?->first_name} {$d->deployment?->intern?->last_name}") ?: $d->deployment?->intern?->name,
            'document_type' => $d->document_type,
            'file_name' => $d->file_name,
            'file_url' => Storage::disk('public')->url($d->file_path),
            'status' => $d->status,
            'remarks' => $d->remarks,
            'uploaded_at' => $d->created_at->local()->format('M d, Y'),
        ]);

        return response()->json(['documents' => $documents, ...Paging::meta($page), 'interns' => $this->internOptionsForSchool($schoolId)]);
    }

    public function storeDocument(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'document_type' => 'required|string|max:100',
            'file' => 'required|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:10240',
        ]);

        $deployment = $this->deploymentForSchool($data['deployment_id'], $schoolId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        $path = $request->file('file')->store("documents/{$schoolId}", 'public');

        $document = Document::create([
            'deployment_id' => $deployment->id,
            'uploaded_by' => $request->user()->id,
            'document_type' => $data['document_type'],
            'file_name' => $request->file('file')->getClientOriginalName(),
            'file_path' => $path,
            'status' => 'pending',
        ]);

        ActivityLogService::record(
            module: 'Documents',
            action: 'Uploaded document',
            description: "{$data['document_type']} uploaded for {$deployment->intern?->name}.",
            schoolId: $schoolId,
            request: $request
        );

        NotificationService::toUser(
            'intern',
            $deployment->intern_id,
            $schoolId,
            'document_uploaded',
            'A document was added to your file',
            "{$data['document_type']} was uploaded by your coordinator.",
            '/intern/documents'
        );

        return response()->json(['success' => true, 'message' => 'Document uploaded.', 'id' => $document->id]);
    }

    public function reviewDocument(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $data = $request->validate([
            'status' => 'required|string|in:approved,rejected',
            'remarks' => 'nullable|string|max:500',
        ]);

        $document = Document::whereIn('deployment_id', $this->deploymentIdsForSchool($schoolId))->find($id);
        if (!$document) {
            return response()->json(['success' => false, 'message' => 'Document not found.'], 404);
        }

        // A double click or a stale screen sends the same decision twice: keep it, but do not
        // notify the intern or log it a second time.
        if ($document->status === $data['status'] && ($document->remarks ?? null) === ($data['remarks'] ?? null)) {
            return response()->json(['success' => true, 'message' => 'Document reviewed.']);
        }

        $document->update(['status' => $data['status'], 'remarks' => $data['remarks'] ?? null, 'reviewed_at' => now()]);
        $document->loadMissing('deployment');

        if ($document->deployment) {
            NotificationService::toUser(
                'intern',
                $document->deployment->intern_id,
                $schoolId,
                'document_reviewed',
                $data['status'] === 'approved' ? 'Document approved' : 'Document rejected',
                "{$document->document_type} was {$data['status']}.",
                '/intern/documents'
            );
        }

        ActivityLogService::record(
            module: 'Documents',
            action: $data['status'] === 'approved' ? 'Approved document' : 'Rejected document',
            description: "{$document->document_type} for {$document->deployment?->intern?->name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Document reviewed.']);
    }

    // ---------------------------------------------------------------
    // Evaluations
    // ---------------------------------------------------------------

    public function evaluationCriteria(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $criteria = EvaluationCriterion::where('school_id', $schoolId)->where('status', 'active')->orderBy('id')->get();

        return response()->json(['criteria' => $criteria]);
    }

    public function storeEvaluationCriterion(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $data = $request->validate([
            'category' => 'nullable|string|max:100',
            'name' => 'required|string|max:150',
            'description' => 'nullable|string|max:500',
            'max_score' => 'required|numeric|min:1|max:100',
            'weight' => 'required|numeric|min:0.1|max:100',
        ]);

        $criterion = EvaluationCriterion::create([...$data, 'school_id' => $schoolId, 'status' => 'active']);

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Added evaluation criterion',
            description: "Added the criterion \"{$criterion->name}\" to the evaluation rubric.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Criterion added.', 'criterion' => $criterion]);
    }

    /** Fixes a criterion's wording. Its points can only change while no evaluation has used it. */
    public function updateEvaluationCriterion(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $criterion = EvaluationCriterion::where('id', $id)->where('school_id', $schoolId)->where('status', 'active')->first();
        if (!$criterion) {
            return response()->json(['success' => false, 'message' => 'Criterion not found.'], 404);
        }

        $data = $request->validate([
            'category' => 'nullable|string|max:100',
            'name' => 'sometimes|required|string|max:150',
            'description' => 'nullable|string|max:500',
            'max_score' => 'sometimes|required|numeric|min:1|max:100',
            'weight' => 'sometimes|required|numeric|min:0.1|max:100',
        ]);

        $pointsChanged = (isset($data['max_score']) && (float) $data['max_score'] !== (float) $criterion->max_score)
            || (isset($data['weight']) && (float) $data['weight'] !== (float) $criterion->weight);
        if ($pointsChanged && DB::table('evaluation_scores')->where('criteria_id', $criterion->id)->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Evaluations already use this criterion, so its points cannot change. Remove it and add a new one instead.',
            ], 422);
        }

        $criterion->update($data);

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Edited evaluation criterion',
            description: "Edited the criterion \"{$criterion->name}\" of the evaluation rubric.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Criterion updated.', 'criterion' => $criterion->fresh()]);
    }

    /** Takes a criterion off the rubric for future evaluations. Past evaluations keep their scores (never deleted). */
    public function destroyEvaluationCriterion(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $criterion = EvaluationCriterion::where('id', $id)->where('school_id', $schoolId)->where('status', 'active')->first();
        if (!$criterion) {
            return response()->json(['success' => false, 'message' => 'Criterion not found.'], 404);
        }

        $criterion->update(['status' => 'inactive']);

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Removed evaluation criterion',
            description: "Removed the criterion \"{$criterion->name}\" from the evaluation rubric. Past evaluations keep their scores.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Criterion removed.']);
    }

    public function evaluations(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deploymentIds = $this->deploymentIdsForSchool($schoolId);

        $query = Evaluation::with(['deployment.intern', 'evaluator', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date');
        $query->orderByDesc('id');

        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        Paging::internNameLike($query, $request->query('search'));

        $page = $query->paginate(Paging::perPage($request, 15, 50));
        $evaluations = collect($page->items())->map(fn (Evaluation $e) => $this->mapEvaluation($e));

        return response()->json(['evaluations' => $evaluations, ...Paging::meta($page), 'interns' => $this->internOptionsForSchool($schoolId)]);
    }

    private function mapEvaluation(Evaluation $e): array
    {
        return [
            'id' => $e->id,
            'deployment_id' => $e->deployment_id,
            'intern_name' => trim("{$e->deployment?->intern?->first_name} {$e->deployment?->intern?->last_name}") ?: $e->deployment?->intern?->name,
            'evaluator_name' => $e->evaluator?->name,
            'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
            'overall_score' => $e->overall_score,
            'remarks' => $e->remarks,
            'category_comments' => $e->category_comments ?? [],
            'status' => $e->status,
            'edited_at' => $e->edited_at?->local()?->format('M d, Y'),
            'scores' => $e->scores->map(fn (EvaluationScore $s) => [
                'criteria_id' => $s->criteria_id,
                'category' => $s->criterion?->category,
                'criterion_name' => $s->criterion?->name,
                'score' => $s->score,
                'max_score' => $s->criterion?->max_score,
                'remarks' => $s->remarks,
            ]),
        ];
    }

    /**
     * The formal, printable internship report for one deployment — everything
     * a coordinator needs to hand off as proof of completion (hours,
     * task/attendance standing, and every evaluation on file). The frontend
     * renders this with `window.print()`, so this only needs to return data,
     * never a rendered document.
     */
    public function internReport(Request $request, int $deploymentId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deployment = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->where('id', $deploymentId)
            ->where('school_id', $schoolId)
            ->first();

        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found.'], 404);
        }

        $profile = InternProfile::where('user_id', $deployment->intern_id)->where('school_id', $schoolId)->first();
        $summary = DeploymentSummaryService::summarize($deployment, $profile);

        $attendanceCounts = Attendance::where('deployment_id', $deployment->id)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $evaluations = Evaluation::with(['evaluator', 'scores.criterion'])
            ->where('deployment_id', $deployment->id)
            ->orderBy('evaluation_date')
            ->get()
            ->map(fn (Evaluation $e) => $this->mapEvaluation($e));

        return response()->json([
            'intern' => [
                'name' => $summary['intern_name'],
                'email' => $deployment->intern?->email,
                'student_number' => $profile?->student_number,
                'course' => $profile?->course,
                'year_level' => $profile?->year_level,
            ],
            'school_name' => $request->user()->school?->school_name,
            'company' => [
                'name' => $deployment->company?->company_name,
                'address' => $deployment->company?->address,
            ],
            'supervisor_name' => $summary['supervisor_name'],
            'deployment' => [
                'start_date' => $summary['start_date'],
                'end_date' => $summary['end_date'],
                'status' => $deployment->status,
            ],
            'summary' => [
                'hours_completed' => $summary['hours_completed'],
                'required_hours' => $summary['required_hours'],
                'hours_progress_pct' => $summary['hours_progress_pct'],
                'tasks_completed' => $summary['tasks_completed'],
                'tasks_total' => $summary['tasks_total'],
                'latest_evaluation_score' => $summary['latest_evaluation_score'],
            ],
            'attendance_summary' => [
                'approved_days' => (int) ($attendanceCounts['approved'] ?? 0),
                'pending_days' => (int) ($attendanceCounts['pending'] ?? 0),
                'rejected_days' => (int) ($attendanceCounts['rejected'] ?? 0),
            ],
            'evaluations' => $evaluations,
            'deployment_history' => DeploymentHistoryService::segments($deployment),
        ]);
    }

    // ---------------------------------------------------------------
    // Companies
    // ---------------------------------------------------------------

    public function companies(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $supervisors = SupervisorProfile::with('user')->where('school_id', $schoolId)->get()->groupBy('company_id');

        $counts = InternMonitoringService::countsByCompany($schoolId);

        $companies = Company::with('locationSetter')->where('school_id', $schoolId)
            ->orderBy('company_name')
            ->get()
            ->map(fn (Company $c) => [
                'id' => $c->id,
                'company_code' => $c->company_code,
                'company_name' => $c->company_name,
                'address' => $c->address,
                'contact_email' => $c->contact_email,
                'contact_number' => $c->contact_number,
                'status' => $c->status,
                ...$c->locationPayload(),
                'active_interns_count' => $counts[$c->id]['active'] ?? 0,
                'completed_interns_count' => $counts[$c->id]['completed'] ?? 0,
                'supervisors_count' => ($supervisors[$c->id] ?? collect())->count(),
                'supervisor_names' => ($supervisors[$c->id] ?? collect())
                    ->map(fn (SupervisorProfile $s) => $this->personName($s->user))->values(),
            ]);

        return response()->json(['companies' => $companies]);
    }

    public function storeCompany(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $this->normalizeEmailInput($request, 'contact_email');
        $data = $request->validate([
            'company_name' => 'required|string|max:255',
            'address' => 'nullable|string|max:500',
            'contact_email' => ['nullable', 'bail', new CompleteEmail],
            'contact_number' => ['nullable', 'string', 'regex:/^[0-9]{11}$/'],
        ]);

        do {
            $code = 'CMP-' . strtoupper(Str::random(6));
        } while (Company::where('company_code', $code)->exists());

        $company = Company::create([...$data, 'school_id' => $schoolId, 'company_code' => $code, 'status' => 'active']);

        ActivityLogService::record(
            module: 'Companies',
            action: 'Added partner company',
            description: "{$company->company_name} added as a partner company.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Company added.', 'company' => $company]);
    }

    public function updateCompany(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $company = Company::where('id', $id)->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        // Only a changed address is checked, so an older saved one never blocks
        // renaming the company or marking it inactive.
        $this->normalizeEmailInput($request, 'contact_email');
        $contactChanged = $request->has('contact_email') && $request->input('contact_email') !== (($company->contact_email === null || $company->contact_email === '') ? null : strtolower($company->contact_email));
        $data = $request->validate([
            'company_name' => 'sometimes|required|string|max:255',
            'address' => 'nullable|string|max:500',
            'contact_email' => $contactChanged ? ['nullable', 'bail', new CompleteEmail] : ['nullable', 'string', 'max:255'],
            'contact_number' => ['nullable', 'string', 'regex:/^[0-9]{11}$/'],
            'status' => 'sometimes|required|string|in:active,inactive',
        ]);

        $company->update($data);

        ActivityLogService::record(
            module: 'Companies',
            action: 'Updated partner company',
            description: "Details of {$company->company_name} were updated.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Company updated.', 'company' => $company]);
    }

    /**
     * "Who's under this company" — every supervisor on file there and every
     * intern currently deployed there, in the same shape the Interns screen
     * already uses so progress numbers read identically in both places.
     */
    public function companyDetail(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $company = Company::with('locationSetter')->where('id', $id)->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        $interns = $this->internRows($schoolId, InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->where('company_id', $company->id)
            ->orderByDesc('id')
            ->get());
        $supervisors = $this->supervisorRows($schoolId, $company->id, InternMonitoringService::countsFrom($interns));

        // Interns who used to be here: their transfer history has this company as the
        // "from" side and they are no longer deployed here. Hidden by default in the UI.
        $movedOut = DeploymentTransfer::where('from_company_id', $company->id)->pluck('deployment_id', 'deployment_id')->all();
        $transferredOut = collect();
        if ($movedOut) {
            $transferredOut = $this->internRows($schoolId, InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
                ->whereIn('id', array_keys($movedOut))->where('company_id', '!=', $company->id)
                ->orderByDesc('id')->get());
            $transferredOut = $transferredOut->map(fn ($r) => $r + ['transferred_out_of' => $company->company_name, 'transferred_to' => $r['company_name']]);
        }

        return response()->json([
            // The map pin is set by the company's supervisors only; here it is read-only.
            'company' => [...$company->toArray(), ...$company->locationPayload()],
            'transferred_out' => $transferredOut->values(),
            'supervisors' => $supervisors->values(),
            'interns' => $interns->values(),
            'summary' => $this->internSummary($interns),
        ]);
    }

    /**
     * Deleting a company would cascade-delete every supervisor profile, deployment,
     * task and certificate template tied to it (and, through those, attendance /
     * evaluations / documents) - so it is blocked outright rather than silently
     * destroying that history; "Mark inactive" is the safe way to retire a company.
     *
     * The rule: a company can be deleted only when nothing at all refers to it.
     * The check and the delete run in one transaction with the company row locked, so a
     * supervisor or intern being added at the same moment either shows up in the check
     * (and blocks the delete) or fails cleanly - it can never be cascade-deleted.
     */
    public function destroyCompany(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $company = Company::where('id', $id)->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        $blocked = DB::transaction(function () use ($company) {
            $locked = Company::whereKey($company->id)->lockForUpdate()->first();
            if (!$locked) {
                return ['gone' => true];
            }

            $supervisorCount = SupervisorProfile::where('company_id', $company->id)->count();
            $deploymentCount = InternshipDeployment::where('company_id', $company->id)->count();
            $activeDeployments = InternshipDeployment::where('company_id', $company->id)->where('status', '!=', 'inactive')->count();
            // Interns who were moved out of here keep this company in their history.
            $deploymentCount += DeploymentTransfer::where('from_company_id', $company->id)->distinct()->count('deployment_id');
            $taskCount = Task::where('company_id', $company->id)->count();

            if ($supervisorCount > 0 || $deploymentCount > 0 || $taskCount > 0) {
                return compact('supervisorCount', 'deploymentCount', 'activeDeployments', 'taskCount');
            }

            $locked->delete();

            return [];
        });

        if (isset($blocked['gone'])) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        if ($blocked) {
            $active = $blocked['activeDeployments'] > 0
                ? " {$blocked['activeDeployments']} of them are still active, so move those interns to another company first."
                : '';

            return response()->json([
                'success' => false,
                'message' => "Can't delete — this company still has {$blocked['supervisorCount']} supervisor(s), {$blocked['deploymentCount']} intern deployment(s) and {$blocked['taskCount']} task(s) on file.{$active} Remove those first, or mark the company inactive instead.",
            ], 422);
        }

        ActivityLogService::record(
            module: 'Companies',
            action: 'Deleted company',
            description: "{$company->company_name} removed - had no supervisors, deployments or tasks on file.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Company deleted.']);
    }

    // ---------------------------------------------------------------
    // Add intern (creates the account + profile + first deployment together —
    // an intern record is only meaningful once placed somewhere, so this is
    // one guided flow rather than two disconnected screens)
    // ---------------------------------------------------------------

    public function supervisors(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $companyId = $request->query('company_id');

        return response()->json(['supervisors' => $this->supervisorRows($schoolId, $companyId ? (int) $companyId : null)->values()]);
    }

    private function personName(?User $u): ?string
    {
        return $u ? (trim("{$u->first_name} {$u->last_name}") ?: $u->name) : null;
    }

    /**
     * Supervisor rows for the list and company screens: the original keys
     * (user_id, name, company_id) plus email, position, status, intern counts
     * and last activity. Intern counts are per COMPANY (every supervisor there
     * handles all of its interns), from one grouped query.
     */
    private function supervisorRows(int $schoolId, ?int $companyId = null, ?array $counts = null)
    {
        $query = SupervisorProfile::with(['user', 'company'])->where('school_id', $schoolId);
        if ($companyId) {
            $query->where('company_id', $companyId);
        }
        $profiles = $query->get();

        $counts ??= InternMonitoringService::countsByCompany($schoolId);

        return $profiles->map(function (SupervisorProfile $s) use ($counts) {
            $u = $s->user;
            $byStatus = $counts[$s->company_id] ?? [];
            $bounced = (bool) $u?->email_bounced_at;
            $status = match (true) {
                $u?->status === 'inactive' => 'inactive',
                $u?->status === 'pending_activation' && $bounced => 'bounced',
                $u?->status === 'pending_activation' => 'pending',
                default => 'active',
            };

            return [
                'user_id' => $s->user_id,
                'name' => $this->personName($u),
                'company_id' => $s->company_id,
                'company_name' => $s->company?->company_name,
                'email' => $u?->email,
                'position' => $s->position,
                'account_status' => $u?->status,
                'email_bounced' => $bounced,
                'status' => $status,
                'interns_count' => (int) ($byStatus['active'] ?? 0),
                'completed_interns_count' => (int) ($byStatus['completed'] ?? 0),
                'last_active_at' => $u?->last_login_at?->toIso8601String(),
            ];
        });
    }

    public function storeSupervisor(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $this->normalizeEmailInput($request);
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:50', 'regex:' . self::PERSON_NAME_PATTERN],
            'last_name' => ['required', 'string', 'max:50', 'regex:' . self::PERSON_NAME_PATTERN],
            'email' => ['required', 'bail', new CompleteEmail, Rule::unique('users', 'email')],
            'company_id' => 'required|integer',
            'position' => 'nullable|string|max:150',
        ]);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select a company that belongs to your school.'], 422);
        }

        // Every company keeps 1-2 supervisors — enough for coverage without
        // spreading oversight so thin the role loses meaning.
        $existingCount = SupervisorProfile::where('company_id', $data['company_id'])->count();
        if ($existingCount >= 2) {
            return response()->json(['success' => false, 'message' => "{$company->company_name} already has the maximum of 2 supervisors."], 422);
        }

        $supervisorRole = Role::where('name', 'supervisor')->first();
        if (!$supervisorRole) {
            return response()->json(['success' => false, 'message' => 'supervisor role is not configured.'], 500);
        }

        // Same safe flow as an intern: the account has no password and cannot
        // log in until the supervisor opens the emailed link and sets their
        // own — which also proves the address is a real inbox
        // (InvitationController::accept sets email_verified_at).
        $user = DB::transaction(function () use ($data, $schoolId, $supervisorRole) {
            $user = User::create([
                'role_id' => $supervisorRole->id,
                'school_id' => $schoolId,
                'name' => "{$data['first_name']} {$data['last_name']}",
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'password' => null,
                'status' => 'pending_activation',
            ]);

            SupervisorProfile::create([
                'user_id' => $user->id,
                'school_id' => $schoolId,
                'company_id' => $data['company_id'],
                'position' => $data['position'] ?? null,
            ]);

            return $user;
        });

        $this->sendAccountInvitation($user, 'Supervisor', "at {$company->company_name}", $request->user());

        ActivityLogService::record(
            module: 'Companies',
            action: 'Invited supervisor',
            description: "{$data['first_name']} {$data['last_name']} invited as a supervisor at {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => 'Invitation sent.',
            'email' => $user->email,
        ]);
    }

    /**
     * Fixes a typo'd name/email or an updated title — the coordinator created
     * this account, so they're the one who can correct it. Password isn't
     * touched here; that stays the supervisor's own concern via their account.
     */
    public function updateSupervisor(Request $request, int $userId): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $profile = SupervisorProfile::where('user_id', $userId)->where('school_id', $schoolId)->first();
        if (!$profile || !$profile->user) {
            return response()->json(['success' => false, 'message' => 'Supervisor not found.'], 404);
        }

        // The address is only checked when it actually changes, so renaming a
        // supervisor never trips over a mailbox that was fine when it was added.
        $this->normalizeEmailInput($request);
        $emailChanged = $request->has('email') && $request->input('email') !== strtolower($profile->user->email);
        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => $emailChanged
                ? ['required', 'bail', new CompleteEmail, Rule::unique('users', 'email')->ignore($userId)]
                : ['required', 'string'],
            'position' => 'nullable|string|max:150',
        ]);

        // A supervisor who has not set up their account has to be re-invited at
        // the new address, which the "Change email" path does (new link, old
        // link dead). Changing it silently here would leave the old link live.
        if ($emailChanged && $profile->user->status === 'pending_activation') {
            return response()->json([
                'success' => false,
                'message' => "This supervisor hasn't set up their account yet. Use \"Change email\" so a new invitation goes to the new address.",
            ], 422);
        }

        $profile->user->update([
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'name' => "{$data['first_name']} {$data['last_name']}",
            // An unchanged address keeps its stored spelling.
            'email' => $emailChanged ? $data['email'] : $profile->user->email,
        ]);
        $profile->update(['position' => $data['position'] ?? null]);

        ActivityLogService::record(
            module: 'Companies',
            action: 'Updated supervisor',
            description: "Details of supervisor {$data['first_name']} {$data['last_name']} were updated.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Supervisor updated.']);
    }

    /**
     * Columns that point at a supervisor's user row and would be wiped (CASCADE) or
     * blanked (SET NULL) if the row were deleted: the tasks they assigned, the
     * evaluations and ratings they gave, attendance they corrected or flagged,
     * activities they reviewed, documents, comments, proofs, messages and the
     * deployment-transfer history. Any hit means the account holds history.
     */
    private const SUPERVISOR_RECORD_COLUMNS = [
        ['tasks', 'assigned_by'],
        ['evaluations', 'evaluator_id'],
        ['task_evaluations', 'evaluator_id'],
        ['task_comments', 'user_id'],
        ['task_proofs', 'uploaded_by'],
        ['documents', 'uploaded_by'],
        ['attendances', 'edited_by'],
        ['attendances', 'red_flag_checked_by'],
        ['daily_activities', 'reviewed_by'],
        ['messages', 'sender_id'],
        ['messages', 'receiver_id'],
        ['group_messages', 'sender_id'],
        ['deployment_transfers', 'from_supervisor_id'],
        ['deployment_transfers', 'to_supervisor_id'],
        ['deployment_transfers', 'transferred_by'],
    ];

    private function supervisorHasRecords(int $userId): bool
    {
        foreach (self::SUPERVISOR_RECORD_COLUMNS as [$table, $column]) {
            if (DB::table($table)->where($column, $userId)->exists()) {
                return true;
            }
        }

        return false;
    }

    /**
     * Interns are no longer assigned to a supervisor individually, so deleting
     * one never orphans an intern; the only guard is that a company keeps at
     * least one supervisor.
     *
     * Deleting the user row would cascade away every task they assigned and every
     * evaluation they gave (and blank who corrected attendance), so a supervisor
     * with any such history is DEACTIVATED instead: they leave the company and can
     * no longer log in, but the account row stays and that history keeps their
     * name. A supervisor with no history at all is deleted outright.
     */
    public function destroySupervisor(Request $request, int $userId): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $profile = SupervisorProfile::where('user_id', $userId)->where('school_id', $schoolId)->first();
        if (!$profile || !$profile->user) {
            return response()->json(['success' => false, 'message' => 'Supervisor not found.'], 404);
        }

        // The company row is locked first so two coordinators removing the last two
        // supervisors at once cannot both pass the "at least 1 left" check.
        $result = DB::transaction(function () use ($profile, $userId) {
            Company::whereKey($profile->company_id)->lockForUpdate()->first();

            // Every company keeps at least 1 supervisor - removing the last one
            // would leave it with no one to oversee interns deployed there.
            $remainingCount = SupervisorProfile::where('company_id', $profile->company_id)->where('user_id', '!=', $userId)->count();
            if ($remainingCount === 0) {
                return ['blocked' => Company::find($profile->company_id)?->company_name];
            }

            $user = User::whereKey($userId)->lockForUpdate()->first();
            $kept = $this->supervisorHasRecords($userId);

            $profile->delete();
            if ($kept) {
                $user->update(['status' => 'inactive', 'invitation_token' => null, 'invitation_expires_at' => null]);
                $user->tokens()->delete();
            } else {
                $user->delete();
            }

            return ['kept' => $kept];
        });

        if (isset($result['blocked'])) {
            return response()->json([
                'success' => false,
                'message' => "Can't delete — {$result['blocked']} needs at least 1 supervisor. Add a replacement first.",
            ], 422);
        }

        $name = trim("{$profile->user->first_name} {$profile->user->last_name}") ?: $profile->user->name;

        ActivityLogService::record(
            module: 'Companies',
            action: $result['kept'] ? 'Deactivated supervisor' : 'Deleted supervisor',
            description: $result['kept']
                ? "{$name} removed as a supervisor; the account was deactivated and their tasks, evaluations and records were kept."
                : "{$name} removed as a supervisor.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json([
            'success' => true,
            'kept_records' => $result['kept'],
            'message' => $result['kept']
                ? 'Supervisor removed. Their account can no longer log in, and the tasks, evaluations and records they made were kept.'
                : 'Supervisor deleted.',
        ]);
    }

    public function storeIntern(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $this->normalizeEmailInput($request);
        // Same name / year-level rules as the bulk import, so the two doors accept the same people.
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:50', 'regex:' . self::PERSON_NAME_PATTERN],
            'last_name' => ['required', 'string', 'max:50', 'regex:' . self::PERSON_NAME_PATTERN],
            'email' => ['required', 'bail', new CompleteEmail, Rule::unique('users', 'email')],
            'course' => 'required|string|max:150',
            'year_level' => ['nullable', 'string', Rule::in(self::IMPORT_YEAR_LEVELS)],
            'company_id' => 'required|integer',
            'start_date' => InternshipDeployment::startDateRules(),
            'end_date' => 'nullable|date|after_or_equal:start_date',
        ], InternshipDeployment::startDateMessages());

        // Only a course the school offers; its required hours come from the school's setting, never a free input.
        $offered = SchoolCourseService::index($schoolId);
        if ($problem = SchoolCourseService::problem($offered, $data['course'])) {
            return response()->json(['success' => false, 'message' => $problem, 'errors' => ['course' => [$problem]]], 422);
        }
        $requiredHours = SchoolCourseService::hours($offered, $data['course']);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select a company that belongs to your school.'], 422);
        }
        if ($company->status !== 'active') {
            return response()->json(['success' => false, 'message' => "{$company->company_name} is marked inactive. Make it active again first, or pick another company."], 422);
        }

        $internRole = Role::where('name', 'intern')->first();
        if (!$internRole) {
            return response()->json(['success' => false, 'message' => 'intern role is not configured.'], 500);
        }

        [$user, $deployment] = DB::transaction(function () use ($data, $schoolId, $internRole, $requiredHours, $request) {
            $user = User::create([
                'role_id' => $internRole->id,
                'school_id' => $schoolId,
                'name' => "{$data['first_name']} {$data['last_name']}",
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'password' => null,
                'status' => 'pending_activation',
            ]);

            InternProfile::create([
                'user_id' => $user->id,
                'school_id' => $schoolId,
                // Filled in by the intern when they activate their account.
                'student_number' => null,
                'course' => Courses::canonical($data['course']),
                'year_level' => $data['year_level'] ?? null,
                'required_hours' => $requiredHours,
            ]);

            $deployment = InternshipDeployment::create([
                'school_id' => $schoolId,
                'intern_id' => $user->id,
                'company_id' => $data['company_id'],
                'coordinator_id' => $request->user()->id,
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'] ?? null,
                'required_hours' => $requiredHours,
                'status' => 'active',
            ]);

            return [$user, $deployment];
        });

        $this->sendAccountInvitation($user, 'Intern', "at {$company->company_name}", $request->user());

        ActivityLogService::record(
            module: 'Interns',
            action: 'Invited intern',
            description: "{$data['first_name']} {$data['last_name']} invited and deployed to {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Invitation sent.', 'deployment_id' => $deployment->id]);
    }

    /** Most rows one import may carry — keeps a single request (and the
     *  burst of invitation emails behind it) to a size that finishes fast. */
    private const IMPORT_MAX_ROWS = 200;
    private const IMPORT_YEAR_LEVELS = ['4th Year', '5th Year'];
    private const PERSON_NAME_PATTERN = "/^[\\p{L}\\p{M}][\\p{L}\\p{M} .'-]*$/u";

    /**
     * Checks an import batch row by row without saving anything, so the
     * coordinator sees every problem — bad formats, duplicates inside the
     * file, emails that already have an account — before a single
     * account is created. Same checks importInterns() runs again for real.
     */
    public function previewInternImport(Request $request): JsonResponse
    {
        $request->validate(['rows' => 'required|array|min:1|max:' . self::IMPORT_MAX_ROWS]);

        ['errors' => $errors, 'existing' => $existing] = $this->analyzeInternImport($request->input('rows'), $request->user()->school_id);

        return response()->json([
            'success' => true,
            'errors' => (object) $errors,
            // Row positions of interns already in this school — shown as
            // "Already added" and skipped, so the same masterlist can be
            // re-uploaded with new names added at the bottom.
            'existing' => $existing,
            'valid_count' => count($request->input('rows')) - count($errors) - count($existing),
        ]);
    }

    /**
     * Creates every intern in the batch with one shared deployment (company,
     * supervisor, start date) — all of it or none of it, so a failure half
     * way can't leave a partial batch behind. Invitations go out afterwards,
     * one queued email per intern spaced a second apart to stay under the
     * mail provider's per-second sending limit.
     */
    public function importInterns(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'rows' => 'required|array|min:1|max:' . self::IMPORT_MAX_ROWS,
            'company_id' => 'required|integer',
            'start_date' => InternshipDeployment::startDateRules(),
        ], InternshipDeployment::startDateMessages());

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select a company that belongs to your school.'], 422);
        }
        if ($company->status !== 'active') {
            return response()->json(['success' => false, 'message' => "{$company->company_name} is marked inactive. Make it active again first, or pick another company."], 422);
        }

        ['errors' => $errors, 'existing' => $existing] = $this->analyzeInternImport($data['rows'], $schoolId);
        if ($errors) {
            return response()->json([
                'success' => false,
                'message' => 'Some rows need fixing before they can be imported.',
                'errors' => (object) $errors,
            ], 422);
        }

        $internRole = Role::where('name', 'intern')->first();
        if (!$internRole) {
            return response()->json(['success' => false, 'message' => 'intern role is not configured.'], 500);
        }

        $existingPositions = array_flip($existing);
        $rows = [];
        foreach ($data['rows'] as $i => $row) {
            if (!isset($existingPositions[$i])) {
                $rows[] = $this->normalizeImportRow($row);
            }
        }
        if (!$rows) {
            return response()->json(['success' => false, 'message' => 'Everyone in this file is already in Internova — there was no one new to add.'], 422);
        }

        $offered = SchoolCourseService::index($schoolId);
        $users = DB::transaction(function () use ($rows, $schoolId, $internRole, $company, $data, $request, $offered) {
            $created = [];
            foreach ($rows as $row) {
                $requiredHours = SchoolCourseService::hours($offered, $row['course']);

                $user = User::create([
                    'role_id' => $internRole->id,
                    'school_id' => $schoolId,
                    'name' => "{$row['first_name']} {$row['last_name']}",
                    'first_name' => $row['first_name'],
                    'last_name' => $row['last_name'],
                    'email' => $row['email'],
                    'password' => null,
                    'status' => 'pending_activation',
                ]);

                InternProfile::create([
                    'user_id' => $user->id,
                    'school_id' => $schoolId,
                    'student_number' => null, // the intern enters it on activation
                    'course' => $row['course'],
                    'year_level' => $row['year_level'],
                    'required_hours' => $requiredHours,
                ]);

                InternshipDeployment::create([
                    'school_id' => $schoolId,
                    'intern_id' => $user->id,
                    'company_id' => $company->id,
                    'coordinator_id' => $request->user()->id,
                    'start_date' => $data['start_date'],
                    'required_hours' => $requiredHours,
                    'status' => 'active',
                ]);

                $created[] = $user;
            }
            return $created;
        });

        foreach ($users as $i => $user) {
            $this->sendAccountInvitation($user, 'Intern', "at {$company->company_name}", $request->user(), delaySeconds: $i);
        }

        ActivityLogService::record(
            module: 'Interns',
            action: 'Imported interns',
            description: count($users) . " interns imported and deployed to {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => count($users) . ' interns added. Invitations are on their way.',
            'created' => count($users),
            'skipped_existing' => count($existing),
        ]);
    }

    /** Trims and canonicalizes one uploaded row the same way for both the
     *  check and the save, so what was checked is exactly what gets stored. */
    private function normalizeImportRow($row): array
    {
        $row = is_array($row) ? $row : [];
        $text = fn ($key) => trim(preg_replace('/\s+/u', ' ', (string) ($row[$key] ?? '')));

        $yearLevel = $text('year_level');

        return [
            'first_name' => $text('first_name'),
            'last_name' => $text('last_name'),
            'email' => strtolower(str_replace(' ', '', $text('email'))),
            'course' => (string) Courses::canonical($text('course')),
            'year_level' => $yearLevel !== '' ? $yearLevel : '4th Year',
        ];
    }

    /**
     * Sorts an import batch into three kinds of rows, keyed by position in
     * the upload:
     * - errors:   ["3" => ["email" => "…"]] — must be fixed or removed;
     * - existing: [5, 9] — interns already in this school, skipped quietly;
     * - every other row is ready to create.
     */
    private function analyzeInternImport(array $rawRows, int $schoolId): array
    {
        $rows = array_map(fn ($row) => $this->normalizeImportRow($row), $rawRows);
        $namePattern = "/^[\\p{L}\\p{M}][\\p{L}\\p{M} .'-]*$/u";
        $errors = [];
        $existing = [];

        $emails = array_filter(array_column($rows, 'email'));
        $internRoleId = Role::where('name', 'intern')->value('id');
        $accounts = User::whereIn('email', $emails)->get(['email', 'school_id', 'role_id'])
            ->keyBy(fn ($u) => strtolower($u->email));

        $emailCounts = array_count_values($emails);
        $offered = SchoolCourseService::index($schoolId);

        foreach ($rows as $i => $row) {
            $rowErrors = [];

            foreach (['first_name' => 'First name', 'last_name' => 'Last name'] as $field => $label) {
                if ($row[$field] === '') {
                    $rowErrors[$field] = "{$label} is required.";
                } elseif (mb_strlen($row[$field]) > 50) {
                    $rowErrors[$field] = "{$label} can be at most 50 characters.";
                } elseif (!preg_match($namePattern, $row[$field])) {
                    $rowErrors[$field] = "{$label} can only have letters, spaces, periods, apostrophes and hyphens.";
                }
            }

            $structure = $row['email'] === '' ? null : CompleteEmail::structureProblem($row['email']);
            if ($row['email'] === '') {
                $rowErrors['email'] = 'Email is required.';
            } elseif ($structure || mb_strlen($row['email']) > 100) {
                $rowErrors['email'] = $structure ?? 'This email address is too long.';
            } elseif (($emailCounts[$row['email']] ?? 0) > 1) {
                $rowErrors['email'] = 'This email appears more than once in the file.';
            } elseif (isset($accounts[$row['email']])) {
                $account = $accounts[$row['email']];
                if ((int) $account->school_id === $schoolId && (int) $account->role_id === (int) $internRoleId) {
                    $existing[] = $i;
                    continue;
                }
                $rowErrors['email'] = 'This email already belongs to another Internova account.';
            } elseif ($problem = EmailDeliverability::problem($row['email'])) {
                $rowErrors['email'] = $problem;
            }

            if ($row['course'] === '') {
                $rowErrors['course'] = 'Course is required.';
            } elseif (mb_strlen($row['course']) > SchoolCourseService::MAX_NAME_LENGTH) {
                $rowErrors['course'] = 'Course can be at most ' . SchoolCourseService::MAX_NAME_LENGTH . ' characters.';
            } elseif ($problem = SchoolCourseService::problem($offered, $row['course'])) {
                $rowErrors['course'] = $problem;
            }

            if (!in_array($row['year_level'], self::IMPORT_YEAR_LEVELS, true)) {
                $rowErrors['year_level'] = 'Year level must be 4th Year or 5th Year.';
            }

            if ($rowErrors) {
                $errors[(string) $i] = $rowErrors;
            }
        }

        return ['errors' => $errors, 'existing' => $existing];
    }

    /**
     * Removing a deployment cascades to its attendance/tasks/evaluations/
     * documents — blocked once any of those exist, since that's real
     * recorded history, not something to lose to an accidental click. With
     * a genuinely empty deployment (e.g. added by mistake, nothing logged
     * yet), this fully undoes storeIntern(): the account, profile, and
     * deployment all go together — there's no other screen that manages an
     * intern account independent of a deployment, so leaving one behind
     * would just be an orphaned, unusable login.
     */
    public function destroyIntern(Request $request, int $deploymentId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deployment = $this->deploymentForSchool($deploymentId, $schoolId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        $internName = $deployment->intern?->name;

        // Count and delete under one lock on the deployment row: an attendance log, task or
        // journal entry saved in the meantime must show up in the count (and block the delete)
        // instead of being cascade-deleted along with the account.
        $recordCount = DB::transaction(function () use ($deployment) {
            $locked = InternshipDeployment::whereKey($deployment->id)->lockForUpdate()->first();
            if (!$locked) {
                return -1;
            }

            $internId = $locked->intern_id;
            $count = Attendance::where('deployment_id', $locked->id)->count()
                + Task::whereHas('assignees', fn ($q) => $q->where('deployment_id', $locked->id))->count()
                + Evaluation::where('deployment_id', $locked->id)->count()
                + Document::where('deployment_id', $locked->id)->count()
                + DB::table('daily_activities')->where('deployment_id', $locked->id)->count()
                + DeploymentTransfer::where('deployment_id', $locked->id)->count()
                + Portfolio::where('intern_id', $internId)->count()
                + DB::table('messages')->where(fn ($q) => $q->where('sender_id', $internId)->orWhere('receiver_id', $internId))->count();

            if ($count > 0) {
                return $count;
            }

            $locked->delete();
            InternProfile::where('user_id', $internId)->delete();
            User::whereKey($internId)->delete();

            return 0;
        });

        if ($recordCount < 0) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        if ($recordCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "This intern can't be deleted because they already have records (attendance, tasks, activities, evaluations, documents or messages). Their history has to stay, so mark the intern inactive instead.",
            ], 422);
        }

        ActivityLogService::record(
            module: 'Interns',
            action: 'Deleted intern',
            description: "{$internName} removed — no attendance, tasks, evaluations, or documents were on file.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Intern deleted.']);
    }

    /**
     * The non-destructive alternative to destroyIntern() — flips a
     * deployment between active and inactive without touching any history
     * (attendance/tasks/evaluations/documents stay exactly as they are).
     * Mirrors the same active/inactive toggle Companies already has, for an
     * intern the coordinator wants to pause or archive rather than delete
     * outright (e.g. one whose deployment already has recorded history, so
     * destroyIntern() would refuse to remove them anyway).
     */
    public function updateInternStatus(Request $request, int $deploymentId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deployment = $this->deploymentForSchool($deploymentId, $schoolId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        $data = $request->validate([
            'status' => 'required|string|in:active,inactive',
        ]);

        $deployment->update(['status' => $data['status']]);

        ActivityLogService::record(
            module: 'Interns',
            action: $data['status'] === 'inactive' ? 'Marked intern inactive' : 'Marked intern active',
            description: "{$deployment->intern?->name} marked {$data['status']}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Status updated.']);
    }

    /**
     * Adjusts the current placement's target — required hours or its start
     * date — without touching the company/supervisor. A straight update in
     * place, since neither field affects the correctness of history already
     * logged against this deployment.
     */
    public function updateDeployment(Request $request, int $deploymentId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deployment = $this->deploymentForSchool($deploymentId, $schoolId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        // The window only applies to a date being changed, so saving the hours of an intern who
        // started months ago does not trip over their original start date.
        $startChanged = $request->input('start_date') !== $deployment->start_date?->toDateString();
        $data = $request->validate([
            'required_hours' => 'required|integer|min:1|max:2000',
            'start_date' => $startChanged ? InternshipDeployment::startDateRules() : 'required|date',
        ], InternshipDeployment::startDateMessages());

        $deployment->update($data);

        ActivityLogService::record(
            module: 'Interns',
            action: 'Updated deployment',
            description: "{$deployment->intern?->name}'s deployment details updated.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Deployment updated.']);
    }

    /**
     * Moves an intern to a different company by editing the SAME deployment in
     * place: company and supervisor change, while attendance, journal, tasks,
     * evaluations and documents stay on that one deployment, so the intern's
     * hours are one running total and they appear once everywhere. The move is
     * recorded in deployment_transfers (history, per-date company on the
     * narrative report, the old company's "Transferred out" list).
     */
    public function reassignIntern(Request $request, int $deploymentId): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deployment = $this->deploymentForSchool($deploymentId, $schoolId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        $data = $request->validate([
            'company_id' => 'required|integer',
            'transferred_on' => 'nullable|date',
            'required_hours' => 'nullable|integer|min:1|max:2000',
            'note' => 'nullable|string|max:255',
        ]);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->where('status', 'active')->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select an active company that belongs to your school.'], 422);
        }
        if ((int) $company->id === (int) $deployment->company_id) {
            return response()->json(['success' => false, 'message' => 'This intern is already at that company.'], 422);
        }


        $movedOn = Carbon::parse($data['transferred_on'] ?? \App\Support\LocalTime::today())->startOfDay();
        if ($deployment->start_date && $movedOn->lt($deployment->start_date)) {
            return response()->json(['success' => false, 'message' => 'The move date cannot be before the deployment started (' . $deployment->start_date->format('M j, Y') . ').'], 422);
        }

        $oldCompanyName = $deployment->company?->company_name;
        $internName = $deployment->intern?->name;
        $approvedHours = DeploymentSummaryService::summarize($deployment, null)['hours_completed'];

        $changed = DB::transaction(function () use ($deployment, $data, $company, $movedOn, $approvedHours, $request) {
            // Company first, then the deployment: the target must still be active, and a second
            // simultaneous move of the same intern must not write a second transfer from the old company.
            $targetCompany = Company::whereKey($company->id)->lockForUpdate()->first();
            $locked = InternshipDeployment::whereKey($deployment->id)->lockForUpdate()->first();

            if (!$targetCompany || $targetCompany->status !== 'active') {
                return 'That company is no longer active. Pick another one.';
            }
            if (!$locked || (int) $locked->company_id !== (int) $deployment->company_id) {
                return 'This intern was just moved by someone else. Refresh and check where they are now.';
            }

            DeploymentTransfer::create([
                'deployment_id' => $locked->id,
                'from_company_id' => $locked->company_id,
                'from_supervisor_id' => null, // supervisors are per company now
                'to_company_id' => $company->id,
                'to_supervisor_id' => null,
                'transferred_on' => $movedOn->toDateString(),
                'approved_hours_at_transfer' => $approvedHours,
                'transferred_by' => $request->user()->id,
                'note' => $data['note'] ?? null,
            ]);
            $locked->update(array_filter([
                'company_id' => $company->id,
                'supervisor_id' => null, // legacy column, cleared: the new company's supervisors take over
                'required_hours' => $data['required_hours'] ?? null,
            ], fn ($v, $k) => $k === 'supervisor_id' || $v !== null, ARRAY_FILTER_USE_BOTH));

            return null;
        });

        if (is_string($changed)) {
            return response()->json(['success' => false, 'message' => $changed], 422);
        }

        ActivityLogService::record(
            module: 'Interns',
            action: 'Reassigned intern',
            description: "{$internName} moved from {$oldCompanyName} to {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Intern reassigned.', 'deployment_id' => $deployment->id]);
    }

    // ---------------------------------------------------------------
    // Shared helper
    // ---------------------------------------------------------------

    private function internOptionsForSchool(int $schoolId): array
    {
        return InternshipDeployment::with('intern')
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->get()
            ->map(fn (InternshipDeployment $d) => [
                'deployment_id' => $d->id,
                'name' => trim("{$d->intern?->first_name} {$d->intern?->last_name}") ?: $d->intern?->name,
            ])
            ->values()
            ->all();
    }
}
