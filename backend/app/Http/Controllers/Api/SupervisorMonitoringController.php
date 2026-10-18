<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Evaluation;
use App\Models\EvaluationCriterion;
use App\Models\EvaluationScore;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Portfolio;
use App\Models\Subtask;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\TaskEvaluation;
use App\Models\TaskProof;
use App\Models\User;
use App\Services\ActivityLogService;
use App\Services\AttendanceSessions;
use App\Services\DashboardQueueService;
use App\Support\LocalTime;
use App\Support\Paging;
use App\Support\TaskListing;
use App\Services\DeploymentSummaryService;
use App\Services\NotificationService;
use App\Services\PlanFeatures;
use App\Services\TaskRatingAverage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * A supervisor sees every intern deployed at their company (shared with the
 * company's other supervisor) via InternshipDeployment::visibleToSupervisor — never their whole
 * school's roster the way a coordinator does. Attendance is the one thing
 * a supervisor can log/approve that a coordinator can't: they're the one
 * who's actually there to see whether the intern showed up.
 */
class SupervisorMonitoringController extends Controller
{
    private function deploymentIdsForSupervisor(User $user): array
    {
        return InternshipDeployment::visibleToSupervisor($user)->pluck('id')->all();
    }

    private function deploymentForSupervisor(int $deploymentId, User $user): ?InternshipDeployment
    {
        return InternshipDeployment::visibleToSupervisor($user)->where('id', $deploymentId)->first();
    }

    /**
     * Dashboard data: the tiles (same definitions as the Interns page) and the "needs attention" queue.
     * red_flags_unchecked replaces the old "attendance to review" tile: attendance is approved the moment
     * it is punched, so the thing a supervisor really has to look at is a red flag nobody has checked.
     */
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->visibleToSupervisor($user)->orderByDesc('id')->get();
        $profiles = InternProfile::where('school_id', $user->school_id)->get()->keyBy('user_id');
        $rows = $deployments->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)))->values();
        $queue = DashboardQueueService::supervisor($user, $deployments, $rows);

        return response()->json([
            'summary' => DeploymentSummaryService::stats($rows) + [
                'red_flags_unchecked' => (int) (collect($queue)->firstWhere('key', 'red_flags')['count'] ?? 0),
            ],
            'queue' => $queue,
            // The dashboard nudges the supervisor to put the company on the map (null: no company profile).
            'company_location_set' => ($company = $this->companyFor($user)) ? $company->hasLocation() : null,
        ]);
    }

    /** The supervisor's "needs attention" list for the bell: only the interns at their own company. */
    public function attentionQueue(User $user): array
    {
        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->visibleToSupervisor($user)->orderByDesc('id')->get();
        $profiles = InternProfile::where('school_id', $user->school_id)->get()->keyBy('user_id');
        $rows = $deployments->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)))->values();

        return DashboardQueueService::supervisor($user, $deployments, $rows);
    }

    public function interns(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $deployments = InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
            ->visibleToSupervisor($request->user())
            ->orderByDesc('id')
            ->get();

        $profiles = InternProfile::where('school_id', $schoolId)->get()->keyBy('user_id');

        $interns = $deployments->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)));

        return response()->json(['interns' => $interns->values()]);
    }

    /**
     * Read-only — a supervisor never edits an intern's portfolio, only
     * views what the intern chose to showcase. Never auto-created here;
     * an intern who hasn't touched their portfolio yet just shows as null
     * rather than conjuring an empty one on their behalf.
     */
    public function internPortfolio(Request $request, int $deploymentId): JsonResponse
    {
        $deployment = $this->deploymentForSupervisor($deploymentId, $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        $portfolio = Portfolio::with('items')->where('intern_id', $deployment->intern_id)->first();

        return response()->json([
            'intern_name' => trim("{$deployment->intern?->first_name} {$deployment->intern?->last_name}") ?: $deployment->intern?->name,
            'portfolio' => $portfolio?->present(),
        ]);
    }

    public function tasks(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;

        $query = Task::with(['assignees.user', 'subtasks', 'evaluation'])->visibleToSupervisor($request->user())->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $notSetUp = InternshipDeployment::with('intern')->visibleToSupervisor($request->user())->where('status', 'active')
            ->whereHas('intern', fn ($q) => $q->where('status', 'pending_activation'))->get()
            ->map(fn ($d) => $d->intern?->name)->filter()->values();

        // ?view=active (open work, whole) or ?view=history (finished and rated, paged); no view = every task.
        if ($listed = TaskListing::respond($request, $query, $this->ratingsEnabled(), fn (Task $t) => $this->mapTaskRow($t))) {
            return response()->json($listed + ['interns' => $this->internOptions($request->user()), 'not_set_up' => $notSetUp]);
        }

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t));

        return response()->json(['tasks' => $tasks, 'interns' => $this->internOptions($request->user()), 'not_set_up' => $notSetUp]);
    }

    private function mapTaskRow(Task $t): array
    {
        $assignees = $t->assignees->map(fn (TaskAssignee $a) => [
            'deployment_id' => $a->deployment_id,
            'user_id' => $a->user_id,
            'name' => trim("{$a->user?->first_name} {$a->user?->last_name}") ?: $a->user?->name,
            // Only an active intern can lead a group task (an inactive one cannot sign in to submit it).
            'can_lead' => $a->user?->status === 'active',
        ]);

        return [
            'id' => $t->id,
            'company_id' => $t->company_id,
            'assignees' => $assignees,
            'is_group' => $assignees->count() > 1,
            'leader_id' => $t->leader_id,
            // 'missing' | 'inactive' | null: the supervisor is asked to choose a (new) leader.
            'leader_problem' => $t->leaderProblem(),
            'title' => $t->title,
            'description' => $t->description,
            'priority' => $t->priority,
            'status' => $t->status,
            'due_date' => $t->due_date?->format('M d, Y'),
            'due_date_raw' => $t->due_date?->format('Y-m-d'),
            'created_at' => $t->created_at->local()->format('M d, Y'),
            'completed_at' => $t->completed_at?->local()?->format('M d, Y'),
            // Done but not graded yet: stays in the Active list until this supervisor rates it.
            'awaiting_rating' => $t->awaitingRating($this->ratingsEnabled()),
            // A rated task is locked; until then the supervisor can still correct its details.
            'can_edit' => $t->evaluation === null,
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

    private function taskForSupervisor(int $taskId, User $user): ?Task
    {
        return Task::visibleToSupervisor($user)->find($taskId);
    }

    private const EVAL_DATE_MESSAGES = ['evaluation_date.before_or_equal' => 'The evaluation date cannot be in the future.'];

    private const DUE_DATE_MESSAGES = [
        'due_date.after_or_equal' => 'The due date cannot be in the past. Choose today or a later date.',
    ];

    /**
     * A due date can only move forward. Rules (days are Manila calendar days): an unchanged date is
     * always fine (so an overdue task can be edited without touching its date); a changed date must be
     * today or later AND not earlier than the date already set. Clearing (null) is the one allowed way
     * back: it just removes the date. Returns the error message, or null when the new value is allowed.
     */
    private function dueDateEditProblem(Task $task, ?string $newRaw): ?string
    {
        $current = $task->due_date?->format('Y-m-d');
        $new = $newRaw ? Carbon::parse($newRaw)->format('Y-m-d') : null;
        if ($new === $current) {
            return null;
        }
        if ($new === null) {
            return null; // clearing removes the date
        }
        if ($new < LocalTime::today()) {
            return 'The due date cannot be in the past. Choose today or a later date.';
        }
        if ($current !== null && $new < $current) {
            return 'The due date can only be moved forward. It is currently ' . Carbon::parse($current)->format('M j, Y') . '.';
        }

        return null;
    }

    public function storeTask(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $supervisorProfile = SupervisorProfile::where('user_id', $supervisorId)->first();
        if (!$supervisorProfile) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        $data = $request->validate([
            'deployment_ids' => 'required|array|min:1',
            'deployment_ids.*' => 'integer',
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'priority' => 'required|string|in:low,medium,high',
            'due_date' => 'nullable|date|after_or_equal:' . LocalTime::today(),
            'leader_id' => 'nullable|integer',
        ], self::DUE_DATE_MESSAGES);

        // Only deployments actually supervised by this supervisor can be
        // assigned — this also silently drops any id that doesn't belong to
        // them rather than trusting the client-submitted list.
        $deployments = InternshipDeployment::with('intern')->visibleToSupervisor($request->user())
            ->whereIn('id', $data['deployment_ids'])
            ->get();

        if ($deployments->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'Select at least one intern at your company.'], 422);
        }

        // Invited interns who have not set up their account cannot take tasks yet.
        $notReady = $deployments->filter(fn ($d) => $d->intern?->status === 'pending_activation');
        if ($notReady->isNotEmpty()) {
            $names = $notReady->map(fn ($d) => $d->intern?->name)->filter()->implode(', ');
            return response()->json(['success' => false, 'message' => "{$names} " . ($notReady->count() === 1 ? 'has' : 'have') . ' not set up an account yet, so a task cannot be assigned. Ask the coordinator to check their email or resend the invitation.'], 422);
        }

        // An intern whose first day has not come yet is not working yet, so nothing can be assigned.
        $notStarted = $deployments->filter(fn ($d) => !$d->hasStartedOn());
        if ($notStarted->isNotEmpty()) {
            $names = $notStarted->map(fn ($d) => ($d->intern?->name ?? 'An intern') . ' (starts ' . $d->start_date->format('M j, Y') . ')')->implode(', ');
            return response()->json(['success' => false, 'message' => "{$names} ". ($notStarted->count() === 1 ? 'has' : 'have') . ' not started the internship yet, so a task cannot be assigned. Choose the interns who have started.'], 422);
        }

        // More than one intern makes it a group task, and a group task needs a leader: the one
        // who submits the parent task once every subtask is done. The leader has to be one of the
        // interns being assigned. A single intern has no leader.
        $leaderId = null;
        if ($deployments->count() > 1) {
            if (empty($data['leader_id'])) {
                return response()->json(['success' => false, 'message' => 'Choose a task leader. With more than one intern, the leader is the one who submits the task once the subtasks are done.', 'errors' => ['leader_id' => ['Choose a task leader.']]], 422);
            }
            if (!$deployments->contains('intern_id', $data['leader_id'])) {
                return response()->json(['success' => false, 'message' => 'The task leader must be one of the interns on this task.', 'errors' => ['leader_id' => ['The leader must be one of the interns on this task.']]], 422);
            }
            $leaderId = $data['leader_id'];
        }

        $task = Task::create([
            'company_id' => $supervisorProfile->company_id,
            'assigned_by' => $supervisorId,
            'leader_id' => $leaderId,
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'priority' => $data['priority'],
            'status' => 'pending',
            'due_date' => $data['due_date'] ?? null,
        ]);

        foreach ($deployments as $deployment) {
            $task->assignees()->create([
                'deployment_id' => $deployment->id,
                'user_id' => $deployment->intern_id,
            ]);
        }

        ActivityLogService::record(
            module: 'Tasks',
            action: 'Assigned task',
            description: "\"{$task->title}\" assigned to " . $deployments->count() . ' intern' . ($deployments->count() === 1 ? '' : 's') . '.',
            schoolId: $request->user()->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Task assigned.', 'id' => $task->id]);
    }

    /**
     * Fix a task's details (title, description, priority, due date) after it was assigned. Any
     * supervisor of the company can do it (same scoping as rating). It stays open until the task is
     * rated: after the grade the task is closed out in History and feeds the intern's evaluation, so
     * changing what was graded would be rewriting the record. Who it is assigned to and its status
     * are not editable here (status follows the interns' work and their subtasks).
     */
    public function updateTask(Request $request, int $id): JsonResponse
    {
        $task = $this->taskForSupervisor($id, $request->user());
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }
        if ($task->isRated()) {
            return response()->json(['success' => false, 'message' => 'This task has already been rated, so it can no longer be edited.'], 422);
        }

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'priority' => 'required|string|in:low,medium,high',
            'due_date' => 'nullable|date',
            'leader_id' => 'nullable|integer',
        ]);
        // A missing due_date key keeps the stored date; an explicit null/empty clears it. Same for the description.
        if (!$request->has('due_date')) {
            $data['due_date'] = $task->due_date?->format('Y-m-d');
        }
        if (!$request->has('description')) {
            $data['description'] = $task->description;
        }

        // The leader of a group task can be chosen or replaced here, from the task's own active interns.
        $task->loadMissing('assignees.user');
        $leaderId = $task->leader_id;
        if ($task->assignees->count() > 1 && $request->filled('leader_id') && (int) $data['leader_id'] !== (int) $task->leader_id) {
            $chosen = $task->assignees->firstWhere('user_id', (int) $data['leader_id'])?->user;
            if (!$chosen) {
                return response()->json(['success' => false, 'message' => 'The task leader must be one of the interns on this task.', 'errors' => ['leader_id' => ['The leader must be one of the interns on this task.']]], 422);
            }
            if ($chosen->status !== 'active') {
                return response()->json(['success' => false, 'message' => 'Choose an intern whose account is active. An inactive intern cannot sign in to submit the task.', 'errors' => ['leader_id' => ['Choose an active intern.']]], 422);
            }
            $leaderId = $chosen->id;
        }
        if ($problem = $this->dueDateEditProblem($task, $data['due_date'] ?? null)) {
            return response()->json(['success' => false, 'message' => $problem, 'errors' => ['due_date' => [$problem]]], 422);
        }
        $data['description'] = isset($data['description']) && trim($data['description']) !== '' ? $data['description'] : null;
        $data['title'] = trim($data['title']);

        $before = [
            'title' => $task->title,
            'description' => $task->description,
            'priority' => $task->priority,
            'due_date' => $task->due_date?->format('Y-m-d'),
            'leader_id' => $task->leader_id,
        ];
        $after = [
            'title' => $data['title'],
            'description' => $data['description'],
            'priority' => $data['priority'],
            'due_date' => !empty($data['due_date']) ? Carbon::parse($data['due_date'])->format('Y-m-d') : null,
            'leader_id' => $leaderId,
        ];
        $changed = array_keys(array_filter($after, fn ($v, $k) => $v !== $before[$k], ARRAY_FILTER_USE_BOTH));
        if (empty($changed)) {
            return response()->json(['success' => true, 'message' => 'Nothing changed.', 'changed' => []]);
        }

        $task->update($after);

        $labels = ['title' => 'title', 'description' => 'description', 'priority' => 'priority', 'due_date' => 'due date', 'leader_id' => 'task leader'];
        $changedText = implode(', ', array_map(fn ($k) => $labels[$k], $changed));
        $dueCleared = in_array('due_date', $changed, true) && $after['due_date'] === null;
        $notifyText = $dueCleared
            ? "\"{$task->title}\": the supervisor removed the due date" . (count($changed) > 1 ? ' and changed the ' . implode(', ', array_map(fn ($k) => $labels[$k], array_values(array_diff($changed, ['due_date'])))) . '.' : '. This task has no due date now.')
            : "\"{$task->title}\": the supervisor changed the {$changedText}.";
        if ($changed === ['leader_id']) {
            $leaderName = $task->assignees->firstWhere('user_id', $leaderId)?->user;
            $leaderName = trim("{$leaderName?->first_name} {$leaderName?->last_name}") ?: $leaderName?->name;
            $notifyText = "\"{$task->title}\": {$leaderName} is now the task leader and submits the task once the subtasks are done.";
        }

        ActivityLogService::record(
            module: 'Tasks',
            action: 'Edited task',
            description: "\"{$task->title}\" edited ({$changedText}).",
            schoolId: $request->user()->school_id,
            request: $request
        );

        $schoolId = $request->user()->school_id;
        foreach ($task->assignees()->pluck('user_id')->unique() as $internId) {
            NotificationService::toUser(
                'intern',
                $internId,
                $schoolId,
                'task_updated',
                'Your task was updated',
                $notifyText,
                "/intern/tasks/{$task->id}"
            );
        }

        return response()->json(['success' => true, 'message' => 'Task updated.', 'changed' => $changed]);
    }

    public function taskShow(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($id, $request->user());
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $task->load(['assignees.user', 'subtasks.assignees', 'subtasks.comments.user', 'subtasks.proofs.uploader', 'comments.user', 'evaluation', 'proofs.uploader']);

        return response()->json(['task' => $this->mapTaskDetail($task)]);
    }

    /**
     * The one thing that actually closes a completed task out — until this
     * exists, the task stays in the Active list even though it's done, so
     * the supervisor doesn't lose track of work waiting on their review.
     */
    public function evaluateTask(Request $request, int $id): JsonResponse
    {
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::TASK_RATINGS)) {
            return response()->json(['success' => false, 'message' => 'Per-task ratings aren\'t included in your school\'s current plan.'], 403);
        }

        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($id, $request->user());
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }
        if ($task->status !== 'completed') {
            return response()->json(['success' => false, 'message' => 'This task is not done yet.'], 422);
        }
        if ($task->hasUnfinishedSubtasks()) {
            return response()->json(['success' => false, 'message' => 'This task still has subtasks that are not done, so it cannot be rated yet.'], 422);
        }

        $data = $request->validate([
            'rating' => 'required|integer|min:1|max:10',
            'comments' => 'nullable|string|max:2000',
        ]);

        TaskEvaluation::updateOrCreate(
            ['task_id' => $task->id],
            [
                'evaluator_id' => $supervisorId,
                'rating' => $data['rating'],
                'comments' => $data['comments'] ?? null,
                'evaluated_at' => now(),
                'status' => 'submitted',
            ]
        );

        $schoolId = $request->user()->school_id;
        foreach ($task->assignees->pluck('user_id')->unique() as $internId) {
            NotificationService::toUser(
                'intern',
                $internId,
                $schoolId,
                'task_evaluated',
                'Your task was rated',
                "\"{$task->title}\" — {$data['rating']}/10",
                '/intern/tasks'
            );
        }

        return response()->json(['success' => true, 'message' => 'Rating saved.']);
    }

    private function mapTaskDetail(Task $t): array
    {
        return [
            ...$this->mapTaskRow($t),
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

    public function storeSubtask(Request $request, int $taskId): JsonResponse
    {
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::SUBTASKS)) {
            return response()->json(['success' => false, 'message' => 'Subtasks aren\'t included in your school\'s current plan.'], 403);
        }

        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($taskId, $request->user());
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        if ($block = $task->subtaskAddBlock()) {
            return response()->json(['success' => false, 'message' => $block], 422);
        }

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'due_date' => 'nullable|date|after_or_equal:' . LocalTime::today(),
            'assignee_ids' => 'nullable|array',
            'assignee_ids.*' => 'integer',
        ], self::DUE_DATE_MESSAGES);

        [$validIds, $problem] = $task->resolveSubtaskAssignees($data['assignee_ids'] ?? []);
        if ($problem) {
            return response()->json(['success' => false] + $problem, 422);
        }

        $subtask = $task->subtasks()->create([
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'status' => 'pending',
            'due_date' => $data['due_date'] ?? null,
        ]);
        $subtask->assignees()->sync($validIds);

        $task->recalculateStatusFromSubtasks();

        return response()->json(['success' => true, 'message' => 'Subtask added.', 'id' => $subtask->id]);
    }

    public function destroySubtask(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $subtask = $this->subtaskForSupervisor($id, $request->user());
        if (!$subtask) {
            return response()->json(['success' => false, 'message' => 'Subtask not found.'], 404);
        }

        $task = $subtask->task;
        // A graded task keeps the work that was graded. Removing a subtask that is not done is still fine
        // (it is how an old task with an unfinished subtask gets cleaned up).
        if ($subtask->status === 'completed' && $task->isRated()) {
            return response()->json(['success' => false, 'message' => 'This task has already been rated, so its finished subtasks can no longer be removed.'], 422);
        }
        $subtask->delete();
        $task->recalculateStatusFromSubtasks();

        return response()->json(['success' => true, 'message' => 'Subtask removed.']);
    }

    private function subtaskForSupervisor(int $subtaskId, User $user): ?Subtask
    {
        return Subtask::whereHas('task', fn ($q) => $q->visibleToSupervisor($user))->find($subtaskId);
    }

    public function storeTaskComment(Request $request, int $taskId): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($taskId, $request->user());
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $data = $request->validate(['comment' => 'required|string|max:2000']);

        $comment = $task->comments()->create([
            'user_id' => $request->user()->id,
            'comment' => $data['comment'],
        ]);
        $comment->load('user');

        $schoolId = $request->user()->school_id;
        foreach ($task->assignees->pluck('user_id')->unique() as $internId) {
            NotificationService::toUser(
                'intern',
                $internId,
                $schoolId,
                'task_comment',
                'New comment on your task',
                "\"{$task->title}\": {$data['comment']}",
                '/intern/tasks'
            );
        }

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    public function storeSubtaskComment(Request $request, int $subtaskId): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $subtask = $this->subtaskForSupervisor($subtaskId, $request->user());
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

        $schoolId = $request->user()->school_id;
        foreach ($subtask->assignees->pluck('id')->unique() as $internId) {
            NotificationService::toUser(
                'intern',
                $internId,
                $schoolId,
                'task_comment',
                'New comment on your subtask',
                "\"{$subtask->title}\": {$data['comment']}",
                '/intern/tasks'
            );
        }

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    public function attendance(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForSupervisor($request->user());

        // Red flags nobody has checked yet come first, then the usual newest-first order.
        $query = Attendance::with('deployment.intern', 'redFlagChecker')
            ->whereIn('deployment_id', $deploymentIds)
            ->pinUncheckedFlags()
            ->orderByDesc('attendance_date')
            ->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }
        $query->internNameLike($request->query('search'))->flagged($request->query('flag'));

        $records = $query->paginate(20);

        return response()->json([
            'records' => collect($records->items())->map(fn (Attendance $a) => [
                'id' => $a->id,
                'deployment_id' => $a->deployment_id,
                'intern_name' => trim("{$a->deployment?->intern?->first_name} {$a->deployment?->intern?->last_name}") ?: $a->deployment?->intern?->name,
                'attendance_date' => $a->attendance_date?->format('M d, Y'),
                'attendance_date_raw' => $a->attendance_date?->toDateString(),
                'session' => $a->session ?: Attendance::FULL,
                'session_label' => match ($a->session) { Attendance::AM => 'Morning', Attendance::PM => 'Afternoon', default => null },
                'clock_in' => $a->clock_in?->local()?->format('h:i A'),
                'clock_in_selfie_url' => $a->clock_in_selfie_path ? Storage::disk('public')->url($a->clock_in_selfie_path) : null,
                'clock_in_location' => $a->clock_in_latitude !== null ? ['lat' => $a->clock_in_latitude, 'lng' => $a->clock_in_longitude] : null,
                'clock_out' => $a->clock_out?->local()?->format('h:i A'),
                'clock_out_selfie_url' => $a->clock_out_selfie_path ? Storage::disk('public')->url($a->clock_out_selfie_path) : null,
                'clock_out_location' => $a->clock_out_latitude !== null ? ['lat' => $a->clock_out_latitude, 'lng' => $a->clock_out_longitude] : null,
                'auto_clocked_out' => (bool) $a->auto_clocked_out,
                'clock_in_is_offline' => (bool) $a->clock_in_is_offline,
                'clock_out_is_offline' => (bool) $a->clock_out_is_offline,
                'clock_in_distance_m' => $a->clock_in_distance_m,
                'clock_out_distance_m' => $a->clock_out_distance_m,
                'location_flags' => array_values(array_unique([...($a->clock_in_location_flags ?? []), ...($a->clock_out_location_flags ?? [])])),
                ...$a->redFlagPayload(),
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
                'status' => $a->status,
                // Every record of the company's interns can be corrected or deleted by a supervisor.
                'edited' => $a->edited_at !== null,
                'can_edit_times' => true,
                'can_delete' => true,
                'is_open' => $a->clock_in !== null && $a->clock_out === null,
                'date_label' => $a->attendance_date?->format('M d, Y'),
                'clock_in_value' => $a->clock_in?->local()?->format('H:i'),
                'clock_out_value' => $a->clock_out?->local()?->format('H:i'),
                'max_hours' => Attendance::maxHoursFor($a->session),
            ]),
            'total' => $records->total(),
            'page' => $records->currentPage(),
            'has_more' => $records->hasMorePages(),
            'interns' => $this->internOptions($request->user()),
            'attendance_mode' => AttendanceSessions::modeFor($this->companyFor($request->user())),
        ]);
    }

    private function companyFor(\App\Models\User $user): ?\App\Models\Company
    {
        return SupervisorProfile::with('company')->where('user_id', $user->id)->first()?->company;
    }

    /**
     * How this company wants attendance recorded. The setting belongs to the
     * company, so every supervisor of it sees and can change the same one.
     */
    public function attendanceSettings(Request $request): JsonResponse
    {
        $company = $this->companyFor($request->user());
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'company' => ['id' => $company->id, 'name' => $company->company_name],
            'attendance_mode' => AttendanceSessions::modeFor($company),
        ]);
    }

    public function updateAttendanceSettings(Request $request): JsonResponse
    {
        $data = $request->validate(['attendance_mode' => 'required|in:single,split']);
        $company = $this->companyFor($request->user());
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        $changed = AttendanceSessions::modeFor($company) !== $data['attendance_mode'];
        $company->update(['attendance_mode' => $data['attendance_mode']]);

        if ($changed) {
            $text = $data['attendance_mode'] === AttendanceSessions::SPLIT
                ? 'Attendance now has four entries a day: morning time in and out, and afternoon time in and out.'
                : 'Attendance now has one time in and one time out a day.';
            // Queued: every notification is also broadcast live, and a company with many interns
            // should not make the supervisor wait for each one.
            \App\Jobs\NotifyInternsAttendanceFormatChanged::dispatch($company->id, $text);
            ActivityLogService::record(
                module: 'Attendance',
                action: 'Changed attendance format',
                description: "{$company->company_name} now records attendance as " . ($data['attendance_mode'] === AttendanceSessions::SPLIT ? 'morning and afternoon' : 'one time in and out') . '.',
                schoolId: $company->school_id,
                request: $request
            );
        }

        return response()->json([
            'success' => true,
            'message' => 'Attendance format saved.',
            'attendance_mode' => AttendanceSessions::modeFor($company->fresh()),
        ]);
    }

    public function storeAttendance(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            // Never a day that has not happened yet (Philippine calendar day).
            'attendance_date' => 'required|date|before_or_equal:' . LocalTime::today(),
            // A record without a time in is an empty row that would only confuse the hours.
            'clock_in' => 'required|date_format:H:i',
            'clock_out' => 'nullable|date_format:H:i|after:clock_in',
            // Afternoon, for companies that record morning and afternoon separately.
            'pm_in' => 'nullable|date_format:H:i|after:clock_out',
            'pm_out' => 'nullable|date_format:H:i|after:pm_in',
        ], [
            'attendance_date.before_or_equal' => 'Attendance cannot be logged for a day that has not happened yet.',
            'clock_in.required' => 'Enter the time in.',
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        // Nothing can be logged before the internship started, or once the required hours are rendered.
        if (!$deployment->hasStartedOn($data['attendance_date'])) {
            return response()->json(['success' => false, 'message' => "Attendance cannot be logged before this intern's internship started on {$deployment->start_date->format('F j, Y')}."], 422);
        }
        if ($deployment->isFinished()) {
            return response()->json(['success' => false, 'message' => 'This intern has already completed the required hours, so attendance is closed.'], 422);
        }

        // A supervisor logging attendance was there to see it happen — no
        // separate approval step needed, unlike a record entered secondhand.
        // The times typed here are Philippine wall-clock times; storage is UTC.
        $at = fn (?string $hm) => $hm ? Carbon::parse("{$data['attendance_date']} {$hm}", LocalTime::tz())->utc() : null;
        $split = !empty($data['pm_in']) || !empty($data['pm_out']);
        $shifts = [[$split ? Attendance::AM : Attendance::FULL, $at($data['clock_in']), $at($data['clock_out'] ?? null), 'clock']];
        if ($split) {
            if (AttendanceSessions::modeFor($this->companyFor($request->user())) !== AttendanceSessions::SPLIT) {
                return response()->json(['success' => false, 'message' => 'This company records one time in and one time out a day. Change the attendance format first to log a morning and an afternoon.', 'errors' => ['pm_in' => ['This company records one time in and one time out a day.']]], 422);
            }
            if (empty($data['pm_in'])) {
                return response()->json(['success' => false, 'message' => 'Enter the afternoon time in.', 'errors' => ['pm_in' => ['Enter the afternoon time in.']]], 422);
            }
            $shifts[] = [Attendance::PM, $at($data['pm_in']), $at($data['pm_out'] ?? null), 'pm'];
        }

        // Same safety rules as "Correct attendance": nothing in the future, no shift longer than a workday
        // (half of one for a morning / afternoon), and no overlap with a record the intern already has that day.
        $fail = fn (string $field, string $message) => response()->json(['success' => false, 'message' => $message, 'errors' => [$field => [$message]]], 422);
        $existing = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', $data['attendance_date'])->whereNotNull('clock_in')->get();
        foreach ($shifts as [$session, $in, $out, $prefix]) {
            $inField = $prefix === 'pm' ? 'pm_in' : 'clock_in';
            $outField = $prefix === 'pm' ? 'pm_out' : 'clock_out';
            if ($in->gt(now())) {
                return $fail($inField, 'The time in cannot be in the future.');
            }
            if ($out) {
                if ($out->gt(now())) {
                    return $fail($outField, 'The time out cannot be in the future.');
                }
                $max = Attendance::maxHoursFor($session);
                if ($in->diffInMinutes($out) > $max * 60) {
                    return $fail($outField, "A shift here can be at most {$max} hours long.");
                }
            }
            $end = $out ?? $in;
            $clash = $existing->first(fn (Attendance $o) => $o->clock_in->lt($end) && ($o->clock_out ?? $o->clock_in)->gt($in));
            if ($clash) {
                $span = $clash->clock_in->local()->format('h:i A') . ($clash->clock_out ? ' to ' . $clash->clock_out->local()->format('h:i A') : '');
                return $fail($inField, "This intern already has attendance on that day ({$span}). Use Correct attendance to change it.");
            }
        }

        $attendance = null;
        foreach ($shifts as [$session, $in, $out]) {
            $row = Attendance::create([
                'deployment_id' => $deployment->id,
                'attendance_date' => $data['attendance_date'],
                'session' => $session,
                'clock_in' => $in,
                'clock_out' => $out,
                'status' => 'approved',
                // An odd-hours time typed by the supervisor is red on the record, but already looked at:
                // it is not pinned as unchecked and nobody is notified (same as "Correct attendance").
                'clock_in_odd_hours' => Attendance::isOddHour($in),
                'red_flag_checked_by' => Attendance::isOddHour($in) ? $request->user()->id : null,
                'red_flag_checked_at' => Attendance::isOddHour($in) ? now() : null,
            ]);
            $attendance ??= $row;
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Logged attendance',
            description: "Attendance logged for {$deployment->intern?->name} on {$data['attendance_date']}.",
            schoolId: $deployment->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Attendance logged.', 'id' => $attendance->id]);
    }

    /**
     * "Correct attendance": the supervisor knows when the intern really came and left, so any record of an
     * intern at their company can be fixed (not only a time-out the system closed). Safety rules: the time out
     * is after the time in, a shift is never longer than Attendance::maxHoursFor() (8 h a whole day, 4 h a
     * morning/afternoon), nothing is in the future, and the shift may not overlap another one of the same day
     * (so a morning always ends before the afternoon starts). The times typed are Philippine wall-clock times;
     * storage is UTC. A shift still open (no time out yet) may have its time in corrected and stay open.
     */
    public function updateAttendanceTimes(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'clock_in' => 'required|date_format:H:i',
            'clock_out' => 'nullable|date_format:H:i',
        ]);

        $attendance = Attendance::with('deployment.intern')
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))
            ->find($id);
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Attendance record not found.'], 404);
        }

        $fail = fn (string $field, string $message) => response()->json(['success' => false, 'message' => $message, 'errors' => [$field => [$message]]], 422);

        $day = $attendance->clock_in ? LocalTime::date($attendance->clock_in) : $attendance->attendance_date->toDateString();
        $in = Carbon::parse("{$day} {$data['clock_in']}", LocalTime::tz())->utc();
        $out = !empty($data['clock_out']) ? Carbon::parse("{$day} {$data['clock_out']}", LocalTime::tz())->utc() : null;

        // A finished shift stays finished: it cannot lose its time out.
        if ($out === null && $attendance->clock_out !== null) {
            return $fail('clock_out', 'Enter the time out.');
        }
        if ($in->gt(now())) {
            return $fail('clock_in', 'The time in cannot be in the future.');
        }
        if ($out) {
            if ($out->lte($in)) {
                return $fail('clock_out', 'The time out must be after the time in.');
            }
            if ($out->gt(now())) {
                return $fail('clock_out', 'The time out cannot be in the future.');
            }
            $max = Attendance::maxHoursFor($attendance->session);
            if ($in->diffInMinutes($out) > $max * 60) {
                return $fail('clock_out', "A shift here can be at most {$max} hours long.");
            }
        }

        // No overlap with the other shift(s) of the same day (touching is fine: out 12:00, in 12:00).
        $end = $out ?? $in;
        $clash = Attendance::where('deployment_id', $attendance->deployment_id)
            ->whereDate('attendance_date', $attendance->attendance_date->toDateString())
            ->where('id', '!=', $attendance->id)
            ->whereNotNull('clock_in')
            ->get()
            ->first(fn (Attendance $o) => $o->clock_in->lt($end) && ($o->clock_out ?? $o->clock_in)->gt($in));
        if ($clash) {
            $label = match ($clash->session) { Attendance::AM => 'morning', Attendance::PM => 'afternoon', default => 'other' };
            $span = $clash->clock_in->local()->format('h:i A') . ($clash->clock_out ? ' to ' . $clash->clock_out->local()->format('h:i A') : '');
            return $fail($out ? 'clock_out' : 'clock_in', "These times overlap the {$label} entry of the same day ({$span}).");
        }

        $oldOddHours = (bool) $attendance->clock_in_odd_hours;
        $changes = [
            'clock_in' => $in,
            'clock_out' => $out,
            'auto_clocked_out' => false,
            'edited_by' => $request->user()->id,
            'edited_at' => now(),
            // The odd-hours red flag follows the corrected time in (Attendance::saving derives red_flag from it).
            'clock_in_odd_hours' => Attendance::isOddHour($in),
        ];
        // The supervisor who types a time that is outside normal hours has looked at the record: it is red but
        // not pinned as unchecked, and nobody is notified. A flag that was already checked stays checked.
        if ($changes['clock_in_odd_hours'] && !$oldOddHours && $attendance->red_flag_checked_at === null) {
            $changes['red_flag_checked_by'] = $request->user()->id;
            $changes['red_flag_checked_at'] = now();
        }
        $attendance->update($changes);

        $hours = $out ? round($in->diffInMinutes($out) / 60, 1) : null;
        $deployment = $attendance->deployment;
        $dateLabel = $attendance->attendance_date->format('M d, Y');
        $times = $in->local()->format('h:i A') . ($out ? ' to ' . $out->local()->format('h:i A') . " ({$hours}h)" : ' (still timed in)');
        if ($deployment) {
            NotificationService::toUser(
                'intern', $deployment->intern_id, $deployment->school_id, 'attendance_edited', 'Your attendance time was corrected',
                "{$dateLabel}: {$times}.",
                '/intern/attendance'
            );
            // The drafted "Daily Activity Summary" quotes the old times: drop the unedited draft and write it again.
            $this->refreshDailySummary($deployment, $attendance->attendance_date->toDateString());
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Corrected attendance time',
            description: "Attendance #{$attendance->id} on {$dateLabel} set to {$times}.",
            schoolId: $deployment?->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Attendance corrected.', 'hours' => $hours]);
    }

    /**
     * "Delete this attendance": the record, its hours and its selfie photos are removed. The intern is told.
     * The drafted "Daily Activity Summary" of that day goes with it when nobody edited it; anything the intern
     * wrote is never touched. Hours, "finished" and the clock-in rules are all computed from the remaining
     * records, so they follow by themselves (an intern whose hours drop below the requirement can clock in again).
     */
    public function destroyAttendance(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['reason' => 'nullable|string|max:255']);

        $attendance = Attendance::with('deployment.intern')
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))
            ->find($id);
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Attendance record not found.'], 404);
        }

        $deployment = $attendance->deployment;
        $date = $attendance->attendance_date->toDateString();
        $dateLabel = $attendance->attendance_date->format('M d, Y');
        $part = match ($attendance->session) { Attendance::AM => ' (morning)', Attendance::PM => ' (afternoon)', default => '' };
        $hours = round($attendance->workedMinutes() / 60, 1);
        $photos = array_filter([$attendance->clock_in_selfie_path, $attendance->clock_out_selfie_path]);
        $internName = trim("{$deployment?->intern?->first_name} {$deployment?->intern?->last_name}") ?: (string) $deployment?->intern?->name;

        DB::transaction(function () use ($attendance, $deployment, $date) {
            $attendance->delete();
            if ($deployment) {
                $this->refreshDailySummary($deployment, $date);
            }
        });

        // Selfies are files on the public disk; the app removes uploaded files elsewhere too (profile photos, certificates).
        foreach ($photos as $path) {
            Storage::disk('public')->delete($path);
        }

        if ($deployment) {
            $reason = !empty($data['reason']) ? " Reason: {$data['reason']}" : '';
            NotificationService::toUser(
                'intern', $deployment->intern_id, $deployment->school_id, 'attendance_deleted', 'An attendance record was removed',
                "Your supervisor removed your attendance for {$dateLabel}{$part}" . ($hours > 0 ? " ({$hours}h)" : '') . ". Your rendered hours were updated.{$reason}",
                '/intern/attendance'
            );
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Deleted attendance',
            description: "Attendance #{$id} of {$internName} on {$dateLabel}{$part} ({$hours}h) was deleted." . (!empty($data['reason']) ? " Reason: {$data['reason']}" : ''),
            schoolId: $deployment?->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Attendance deleted.']);
    }

    /**
     * Keeps the system-drafted daily summary honest after attendance changed. Only an unedited draft
     * (is_auto_generated and still "recorded") is removed; an entry the intern wrote or edited stays. When the
     * day still has finished attendance the draft is written again from the new times, otherwise it stays gone.
     */
    private function refreshDailySummary(InternshipDeployment $deployment, string $date): void
    {
        $removed = DailyActivity::where('deployment_id', $deployment->id)
            ->whereDate('activity_date', $date)
            ->where('is_auto_generated', true)
            ->where('status', DailyActivity::RECORDED)
            ->delete();
        if (!$removed) {
            return;
        }

        $left = Attendance::where('deployment_id', $deployment->id)->whereDate('attendance_date', $date)
            ->whereNotNull('clock_in')->whereNotNull('clock_out')
            ->orderByDesc('id')->first();
        if ($left) {
            // After the commit, so the worker already sees the old draft gone.
            \App\Jobs\GenerateNarrativeForAttendance::dispatch($left->id)->afterCommit();
        }
    }

    /**
     * The supervisor has looked at a red-flagged record (the odd-hours clock-in or the suspicious location).
     * It stops being pinned to the top of the list but keeps its red badge, and who/when is stored.
     */
    public function checkRedFlag(Request $request, int $id): JsonResponse
    {
        $attendance = Attendance::with('deployment.intern')->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))->find($id);
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Attendance record not found.'], 404);
        }
        if (!$attendance->red_flag) {
            return response()->json(['success' => false, 'message' => 'This record has no red flag.'], 422);
        }
        if ($attendance->red_flag_checked_at === null) {
            $attendance->update(['red_flag_checked_by' => $request->user()->id, 'red_flag_checked_at' => now()]);
            ActivityLogService::record(
                module: 'Attendance',
                action: 'Checked a red flag',
                description: "Red flag on attendance #{$attendance->id} ({$attendance->attendance_date->format('M d, Y')}) was marked as checked.",
                schoolId: $attendance->deployment?->school_id,
                request: $request
            );
        }

        return response()->json(['success' => true, 'message' => 'Marked as checked.']);
    }

    public function reviewAttendance(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $data = $request->validate(['status' => 'required|string|in:approved,rejected']);

        $attendance = Attendance::whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))->find($id);
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Attendance record not found.'], 404);
        }

        $attendance->update(['status' => $data['status']]);
        $attendance->loadMissing('deployment');

        if ($attendance->deployment) {
            NotificationService::toUser(
                'intern',
                $attendance->deployment->intern_id,
                $attendance->deployment->school_id,
                'attendance_reviewed',
                $data['status'] === 'approved' ? 'Attendance approved' : 'Attendance rejected',
                "{$attendance->attendance_date->format('M d, Y')} attendance was {$data['status']}.",
                '/intern/attendance'
            );
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: $data['status'] === 'approved' ? 'Approved attendance' : 'Rejected attendance',
            description: "Attendance #{$attendance->id} on {$attendance->attendance_date->format('M d, Y')}.",
            schoolId: $attendance->deployment?->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Attendance updated.']);
    }

    private function internOptions(User $user): array
    {
        return InternshipDeployment::with('intern')
            ->visibleToSupervisor($user)
            ->accountSetUp()
            ->where('status', 'active')
            ->get()
            ->map(fn (InternshipDeployment $d) => [
                'deployment_id' => $d->id,
                'user_id' => $d->intern_id,
                'name' => trim("{$d->intern?->first_name} {$d->intern?->last_name}") ?: $d->intern?->name,
                // Set while the first day is still ahead: such an intern cannot be given tasks or attendance yet.
                'starts_on' => $d->hasStartedOn() ? null : $d->start_date->toDateString(),
                'starts_on_label' => $d->hasStartedOn() ? null : $d->start_date->format('M j, Y'),
            ])
            ->values()
            ->all();
    }

    // ---------------------------------------------------------------
    // Evaluations — the school's rubric belongs to the coordinator (see
    // CoordinatorMonitoringController), but the supervisor is the one who
    // actually fills it in for the interns they supervise.
    // ---------------------------------------------------------------

    /**
     * The only auto-graded section is Technical Ability — those line
     * items are literally about the intern's actual task work, so their
     * suggested score comes straight from the average of every task
     * rating the supervisor has already given this intern (see
     * TaskRatingAverage). This is a fixed rule, not something a
     * coordinator configures per criterion.
     */
    private const AUTO_GRADED_CATEGORY = 'A. Technical Ability';

    public function evaluationCriteria(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $criteria = EvaluationCriterion::where('school_id', $schoolId)->where('status', 'active')->orderBy('id')->get();

        $taskRatingAverage = null;
        if ($deploymentId = $request->query('deployment_id')) {
            $taskRatingAverage = TaskRatingAverage::forDeployment((int) $deploymentId);
        }

        $criteria = $criteria->map(function (EvaluationCriterion $c) use ($taskRatingAverage) {
            $row = $c->toArray();
            $isAutoGraded = $c->category === self::AUTO_GRADED_CATEGORY;
            $row['task_rating_average'] = $isAutoGraded ? $taskRatingAverage : null;
            $row['suggested_score'] = ($isAutoGraded && $taskRatingAverage !== null)
                ? TaskRatingAverage::scaledTo($taskRatingAverage, (float) $c->max_score)
                : null;

            return $row;
        });

        return response()->json(['criteria' => $criteria]);
    }

    public function evaluations(Request $request): JsonResponse
    {
        $deploymentIds = $this->deploymentIdsForSupervisor($request->user());

        $query = Evaluation::with(['deployment.intern', 'evaluator', 'editor', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date')
            ->orderByDesc('id');

        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        // Each intern is meant to have one evaluation; when older data holds several, the first one
        // per deployment in this ordering is the official one (see Evaluation::officialQuery).
        $all = $query->get();
        $officialIds = $all->unique('deployment_id')->pluck('id')->flip();
        $evaluations = $all->map(fn (Evaluation $e) => $this->mapEvaluation($e) + ['is_official' => isset($officialIds[$e->id])]);

        return response()->json(['evaluations' => $evaluations, 'interns' => $this->evaluationInternOptions($request->user())]);
    }

    /**
     * The interns this supervisor can rate, with whether they can be rated yet. An intern who has
     * not rendered the required hours (or who already has an evaluation) stays in the list so the
     * supervisor sees why they cannot be picked.
     */
    private function evaluationInternOptions(User $user): array
    {
        $deployments = InternshipDeployment::with('intern')
            ->visibleToSupervisor($user)
            ->accountSetUp()
            ->whereIn('status', ['active', 'completed'])
            ->get();

        $existing = Evaluation::whereIn('deployment_id', $deployments->pluck('id'))
            ->orderByDesc('evaluation_date')->orderByDesc('id')
            ->get(['id', 'deployment_id'])
            ->groupBy('deployment_id');

        return $deployments->map(function (InternshipDeployment $d) use ($existing) {
            $block = $this->evaluationBlock($d, $existing->has($d->id));

            return [
                'deployment_id' => $d->id,
                'user_id' => $d->intern_id,
                'name' => $this->internDisplayName($d),
                'starts_on' => $d->hasStartedOn() ? null : $d->start_date->toDateString(),
                'starts_on_label' => $d->hasStartedOn() ? null : $d->start_date->format('M j, Y'),
                'approved_hours' => round($d->approvedHours(), 1),
                'required_hours' => (int) $d->required_hours,
                'finished' => $d->isFinished(),
                'evaluation_id' => $existing->get($d->id)?->first()->id,
                'evaluation_count' => $existing->get($d->id)?->count() ?? 0,
                'can_evaluate' => $block === null,
                'block_code' => $block['code'] ?? null,
                'block_reason' => $block['message'] ?? null,
            ];
        })->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()->all();
    }

    private function internDisplayName(InternshipDeployment $d): ?string
    {
        return trim("{$d->intern?->first_name} {$d->intern?->last_name}") ?: $d->intern?->name;
    }

    /**
     * Why this intern cannot get a new evaluation, or null when they can: the required hours must be
     * rendered first (the same finish rule that closes attendance), and there is one evaluation per
     * intern, so a second one is refused and the existing one is edited instead.
     *
     * @return array{code:string,message:string}|null
     */
    private function evaluationBlock(InternshipDeployment $d, bool $alreadyEvaluated): ?array
    {
        $name = $this->internDisplayName($d) ?? 'This intern';
        if ($alreadyEvaluated) {
            return ['code' => 'already_evaluated', 'message' => "{$name} already has an evaluation. Open it in the list and use Edit to change it."];
        }
        if (!$d->isFinished()) {
            $required = (int) $d->required_hours;
            $rendered = round($d->approvedHours(), 1);

            return ['code' => 'not_finished', 'message' => $required > 0
                ? "{$name} has rendered {$rendered} of {$required} required hours. An evaluation can only be recorded once the required hours are completed."
                : "{$name} has no required hours set yet, so the internship cannot be marked finished. Ask the coordinator to set the required hours."];
        }

        return null;
    }

    private function mapEvaluation(Evaluation $e): array
    {
        return [
            'id' => $e->id,
            'deployment_id' => $e->deployment_id,
            'intern_name' => trim("{$e->deployment?->intern?->first_name} {$e->deployment?->intern?->last_name}") ?: $e->deployment?->intern?->name,
            'evaluator_name' => $e->evaluator?->name,
            'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
            'evaluation_date_raw' => $e->evaluation_date?->format('Y-m-d'),
            'overall_score' => $e->overall_score,
            'remarks' => $e->remarks,
            'category_comments' => $e->category_comments ?? [],
            'status' => $e->status,
            'edited_at' => $e->edited_at?->local()?->format('M d, Y'),
            'edited_by_name' => $e->edited_at ? $e->editor?->name : null,
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
     * Weighted overall score (0-100) for a set of criterion scores, or an error message when a score
     * is above its criterion's maximum.
     *
     * @return array{0:?float,1:?string} [overall, error]
     */
    private function weightedOverall(array $scores, $criteria): array
    {
        $totalWeight = $criteria->sum('weight');
        $weightedSum = 0;
        foreach ($scores as $s) {
            $criterion = $criteria->get($s['criteria_id']);
            if ((float) $s['score'] > (float) $criterion->max_score) {
                return [null, "The score for \"{$criterion->name}\" cannot be higher than {$criterion->max_score}."];
            }
            $normalized = $criterion->max_score > 0 ? ($s['score'] / $criterion->max_score) * 100 : 0;
            $weightedSum += $normalized * $criterion->weight;
        }

        return [$totalWeight > 0 ? round($weightedSum / $totalWeight, 2) : null, null];
    }

    /** Loads the criteria a score list refers to (they must all belong to the school), keyed by id; null if any does not. */
    private function criteriaForScores(array $scores, int $schoolId)
    {
        $ids = collect($scores)->pluck('criteria_id');
        $criteria = EvaluationCriterion::whereIn('id', $ids)->where('school_id', $schoolId)->get()->keyBy('id');

        return $criteria->count() === $ids->unique()->count() ? $criteria : null;
    }

    private function noFormalEvaluationsResponse(): JsonResponse
    {
        return response()->json(['success' => false, 'message' => 'Formal, criteria-based evaluations aren\'t included in your school\'s current plan. Use the manual evaluation instead.'], 403);
    }

    public function storeEvaluation(Request $request): JsonResponse
    {
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::FORMAL_EVALUATIONS)) {
            return $this->noFormalEvaluationsResponse();
        }

        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            // One evaluation per intern: there is no Prelim / Midterm / Final to choose (an old client that
            // still sends evaluation_type is ignored).
            'evaluation_date' => 'required|date|before_or_equal:' . LocalTime::today(),
            'remarks' => 'nullable|string|max:1000',
            'category_comments' => 'nullable|array',
            'category_comments.*' => 'nullable|string|max:500',
            'scores' => 'required|array|min:1',
            'scores.*.criteria_id' => 'required|integer|distinct|exists:evaluation_criteria,id',
            'scores.*.score' => 'required|numeric|min:0',
            'scores.*.remarks' => 'nullable|string|max:500',
        ], self::EVAL_DATE_MESSAGES);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        $criteria = $this->criteriaForScores($data['scores'], $schoolId);
        if ($criteria === null) {
            return response()->json(['success' => false, 'message' => 'One or more criteria do not belong to your school.'], 422);
        }
        [$overallScore, $scoreError] = $this->weightedOverall($data['scores'], $criteria);
        if ($scoreError) {
            return response()->json(['success' => false, 'message' => $scoreError], 422);
        }

        // Locking the deployment row makes two submits at the same moment line up, so the second one
        // sees the first evaluation and is refused instead of creating a duplicate.
        $result = DB::transaction(function () use ($deployment, $data, $overallScore, $supervisorId) {
            $locked = InternshipDeployment::where('id', $deployment->id)->lockForUpdate()->first();
            if ($block = $this->evaluationBlock($locked, Evaluation::where('deployment_id', $locked->id)->exists())) {
                return $block;
            }

            $evaluation = Evaluation::create([
                'deployment_id' => $locked->id,
                'evaluator_id' => $supervisorId,
                'evaluation_date' => $data['evaluation_date'],
                'overall_score' => $overallScore,
                'remarks' => $data['remarks'] ?? null,
                'category_comments' => $data['category_comments'] ?? null,
                'status' => 'submitted',
            ]);
            foreach ($data['scores'] as $s) {
                EvaluationScore::create([
                    'evaluation_id' => $evaluation->id,
                    'criteria_id' => $s['criteria_id'],
                    'score' => $s['score'],
                    'remarks' => $s['remarks'] ?? null,
                ]);
            }

            return $evaluation;
        });
        if (is_array($result)) {
            return response()->json(['success' => false, 'code' => $result['code'], 'message' => $result['message']], 422);
        }
        $evaluation = $result;

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Submitted evaluation',
            description: "Evaluation for {$deployment->intern?->name} — score {$overallScore}.",
            schoolId: $schoolId,
            request: $request
        );

        NotificationService::toUser(
            'intern',
            $deployment->intern_id,
            $schoolId,
            'evaluation_submitted',
            'New evaluation received',
            "Evaluation — overall score {$overallScore}%.",
            '/intern/evaluations'
        );

        return response()->json(['success' => true, 'message' => 'Evaluation submitted.', 'id' => $evaluation->id]);
    }

    /**
     * The Basic-plan counterpart to storeEvaluation() — a school without
     * Formal Evaluations still needs some way to grade an intern, just
     * without the criteria rubric: one overall score the supervisor enters
     * directly, plus remarks. No EvaluationScore rows are created, since
     * there's no per-criterion breakdown to attach them to.
     */
    public function storeManualEvaluation(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'evaluation_date' => 'required|date|before_or_equal:' . LocalTime::today(),
            'overall_score' => 'required|numeric|min:0|max:100',
            'remarks' => 'nullable|string|max:2000',
        ], self::EVAL_DATE_MESSAGES);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        $result = DB::transaction(function () use ($deployment, $data, $supervisorId) {
            $locked = InternshipDeployment::where('id', $deployment->id)->lockForUpdate()->first();
            if ($block = $this->evaluationBlock($locked, Evaluation::where('deployment_id', $locked->id)->exists())) {
                return $block;
            }

            return Evaluation::create([
                'deployment_id' => $locked->id,
                'evaluator_id' => $supervisorId,
                'evaluation_date' => $data['evaluation_date'],
                'overall_score' => $data['overall_score'],
                'remarks' => $data['remarks'] ?? null,
                'status' => 'submitted',
            ]);
        });
        if (is_array($result)) {
            return response()->json(['success' => false, 'code' => $result['code'], 'message' => $result['message']], 422);
        }
        $evaluation = $result;

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Submitted manual evaluation',
            description: "Manual evaluation for {$deployment->intern?->name} — score {$data['overall_score']}.",
            schoolId: $schoolId,
            request: $request
        );

        NotificationService::toUser(
            'intern',
            $deployment->intern_id,
            $schoolId,
            'evaluation_submitted',
            'New evaluation received',
            "Evaluation received — overall score {$data['overall_score']}%.",
            '/intern/evaluations'
        );

        return response()->json(['success' => true, 'message' => 'Evaluation submitted.', 'id' => $evaluation->id]);
    }

    /**
     * Change an evaluation after it was submitted. Any supervisor of the company can do it, at any time
     * (same scoping as creating one). Both kinds are editable: a criteria-based evaluation sends every
     * criterion score again (suggested Technical Ability scores are only suggestions, any value up to the
     * criterion's maximum is accepted, as when creating); one without a breakdown sends its overall score.
     * The total is recomputed, evaluator_id stays the original evaluator, and edited_at / edited_by record
     * the change. The intern is told.
     */
    public function updateEvaluation(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $schoolId = $user->school_id;

        $evaluation = Evaluation::with(['deployment.intern', 'scores'])
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($user))
            ->find($id);
        if (!$evaluation) {
            return response()->json(['success' => false, 'message' => 'Evaluation not found.'], 404);
        }

        $formal = $request->has('scores');
        if (!$formal && $evaluation->scores->isNotEmpty()) {
            return response()->json(['success' => false, 'message' => 'This evaluation is scored per criterion, so every criterion score is needed.'], 422);
        }

        $before = $evaluation->overall_score;
        if ($formal) {
            if (!PlanFeatures::has($user->school, PlanFeatures::FORMAL_EVALUATIONS)) {
                return $this->noFormalEvaluationsResponse();
            }
            $data = $request->validate([
                'evaluation_date' => 'required|date|before_or_equal:' . LocalTime::today(),
                'remarks' => 'nullable|string|max:1000',
                'category_comments' => 'nullable|array',
                'category_comments.*' => 'nullable|string|max:500',
                'scores' => 'required|array|min:1',
                'scores.*.criteria_id' => 'required|integer|distinct|exists:evaluation_criteria,id',
                'scores.*.score' => 'required|numeric|min:0',
                'scores.*.remarks' => 'nullable|string|max:500',
            ], self::EVAL_DATE_MESSAGES);
            $criteria = $this->criteriaForScores($data['scores'], $schoolId);
            if ($criteria === null) {
                return response()->json(['success' => false, 'message' => 'One or more criteria do not belong to your school.'], 422);
            }
            [$overallScore, $scoreError] = $this->weightedOverall($data['scores'], $criteria);
            if ($scoreError) {
                return response()->json(['success' => false, 'message' => $scoreError], 422);
            }

            DB::transaction(function () use ($evaluation, $data, $overallScore, $user) {
                $evaluation->update([
                    'evaluation_date' => $data['evaluation_date'],
                    'overall_score' => $overallScore,
                    'remarks' => $data['remarks'] ?? null,
                    'category_comments' => $data['category_comments'] ?? null,
                    'edited_at' => now(),
                    'edited_by' => $user->id,
                ]);
                $evaluation->scores()->delete();
                foreach ($data['scores'] as $s) {
                    EvaluationScore::create([
                        'evaluation_id' => $evaluation->id,
                        'criteria_id' => $s['criteria_id'],
                        'score' => $s['score'],
                        'remarks' => $s['remarks'] ?? null,
                    ]);
                }
            });
        } else {
            $data = $request->validate([
                'evaluation_date' => 'required|date|before_or_equal:' . LocalTime::today(),
                'overall_score' => 'required|numeric|min:0|max:100',
                'remarks' => 'nullable|string|max:2000',
            ], self::EVAL_DATE_MESSAGES);
            $overallScore = $data['overall_score'];
            $evaluation->update([
                'evaluation_date' => $data['evaluation_date'],
                'overall_score' => $overallScore,
                'remarks' => $data['remarks'] ?? null,
                'edited_at' => now(),
                'edited_by' => $user->id,
            ]);
        }

        $internName = $evaluation->deployment?->intern?->name;
        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Edited evaluation',
            description: "Evaluation for {$internName} edited — score " . ($before !== null ? (float) $before : '—') . " to {$overallScore}.",
            schoolId: $schoolId,
            request: $request
        );

        NotificationService::toUser(
            'intern',
            $evaluation->deployment->intern_id,
            $schoolId,
            'evaluation_updated',
            'Your evaluation was updated',
            "Your supervisor updated your evaluation — overall score {$overallScore}%.",
            '/intern/evaluations'
        );

        return response()->json(['success' => true, 'message' => 'Evaluation updated.', 'id' => $evaluation->id]);
    }

    // ---------------------------------------------------------------
    // Daily activities — the intern's own narrative log (see
    // InternMonitoringController::activities/storeActivity); a supervisor
    // only ever reviews entries from interns actually deployed to them.
    // ---------------------------------------------------------------

    public function activities(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForSupervisor($request->user());

        $query = DailyActivity::with('deployment.intern')
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('activity_date');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        // Entries waiting for review across the whole filtered scope (not just this page), so
        // "Approve all pending" can name the real number.
        $pendingQuery = DailyActivity::whereIn('deployment_id', $deploymentIds)->where('status', DailyActivity::PENDING);
        if ($internId = $request->query('intern_id')) {
            $pendingQuery->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        $page = $query->orderByDesc('id')->paginate(Paging::perPage($request, 20, 50));

        $activities = collect($page->items())->map(fn (DailyActivity $a) => [
            'id' => $a->id,
            'deployment_id' => $a->deployment_id,
            'intern_name' => trim("{$a->deployment?->intern?->first_name} {$a->deployment?->intern?->last_name}") ?: $a->deployment?->intern?->name,
            'activity_date' => $a->activity_date?->format('M d, Y'),
            'title' => $a->title,
            'description' => $a->description,
            'photo_url' => $a->photo_path ? Storage::disk('public')->url($a->photo_path) : null,
            'status' => $a->status,
            'is_auto_generated' => $a->is_auto_generated,
            'review_remarks' => $a->review_remarks,
        ]);

        return response()->json([
            'activities' => $activities,
            ...Paging::meta($page),
            'pending_total' => $pendingQuery->count(),
            'interns' => $this->internOptions($request->user()),
        ]);
    }

    public function reviewActivity(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $data = $request->validate([
            'status' => 'required|string|in:approved,rejected',
            'review_remarks' => 'nullable|string|max:500',
        ]);

        $activity = DailyActivity::whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))->find($id);
        if (!$activity) {
            return response()->json(['success' => false, 'message' => 'Activity entry not found.'], 404);
        }
        // Only an entry waiting for review can be decided — a recorded
        // summary needs no sign-off, and a decision already made is final.
        if ($activity->status !== DailyActivity::PENDING) {
            return response()->json(['success' => false, 'message' => 'This entry is not waiting for review.'], 422);
        }

        $activity->update([
            'status' => $data['status'],
            'reviewed_by' => $supervisorId,
            'review_remarks' => $data['review_remarks'] ?? null,
        ]);
        $activity->loadMissing('deployment');

        if ($activity->deployment) {
            NotificationService::toUser(
                'intern',
                $activity->deployment->intern_id,
                $activity->deployment->school_id,
                'activity_reviewed',
                $data['status'] === 'approved' ? 'Activity log approved' : 'Activity log rejected',
                "\"{$activity->title}\" was {$data['status']}.",
                '/intern/activities'
            );
        }

        ActivityLogService::record(
            module: 'Activities',
            action: $data['status'] === 'approved' ? 'Approved activity entry' : 'Rejected activity entry',
            description: "\"{$activity->title}\" for {$activity->deployment?->intern?->name}.",
            schoolId: $activity->deployment?->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Activity reviewed.']);
    }

    /**
     * "Approve all" — approves the pending entries the supervisor was looking
     * at (the ids come from their current list, so nothing they haven't seen
     * gets signed off). Entries that aren't theirs or aren't pending are
     * skipped. Each intern gets one notification for the batch rather than
     * one per entry.
     */
    public function approveActivities(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $data = $request->validate([
            'ids' => 'required_without:all_pending|array|min:1|max:500',
            'ids.*' => 'integer',
            // The list is paged, so "approve all" can mean every pending entry in scope, not only the loaded ones.
            'all_pending' => 'nullable|boolean',
            'intern_id' => 'nullable|integer',
        ]);

        $activities = DailyActivity::with('deployment.intern')
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))
            ->where('status', DailyActivity::PENDING)
            ->when(!empty($data['all_pending']),
                fn ($q) => $q->when($data['intern_id'] ?? null, fn ($q, $internId) => $q->whereHas('deployment', fn ($d) => $d->where('intern_id', $internId))),
                fn ($q) => $q->whereIn('id', $data['ids'] ?? []))
            ->get();

        if ($activities->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'There are no pending entries to approve.'], 422);
        }

        DailyActivity::whereIn('id', $activities->pluck('id'))->update([
            'status' => DailyActivity::APPROVED,
            'reviewed_by' => $supervisorId,
            'updated_at' => now(),
        ]);

        foreach ($activities->groupBy('deployment_id') as $entries) {
            $deployment = $entries->first()->deployment;
            if (!$deployment) {
                continue;
            }
            $count = $entries->count();
            NotificationService::toUser(
                'intern',
                $deployment->intern_id,
                $deployment->school_id,
                'activity_reviewed',
                $count === 1 ? 'Activity log approved' : 'Activity logs approved',
                $count === 1 ? "\"{$entries->first()->title}\" was approved." : "{$count} of your activity entries were approved.",
                '/intern/activities'
            );
        }

        $total = $activities->count();
        ActivityLogService::record(
            module: 'Activities',
            action: 'Approved activity entries',
            description: "Approved {$total} " . ($total === 1 ? 'entry' : 'entries') . ' at once.',
            schoolId: $activities->first()->deployment?->school_id,
            request: $request
        );

        return response()->json([
            'success' => true,
            'approved' => $total,
            'message' => $total === 1 ? '1 entry approved.' : "{$total} entries approved.",
        ]);
    }
}
