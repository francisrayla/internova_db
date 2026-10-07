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
use App\Support\LocalTime;
use App\Services\DeploymentSummaryService;
use App\Services\NotificationService;
use App\Services\PlanFeatures;
use App\Services\TaskRatingAverage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t));

        $notSetUp = InternshipDeployment::with('intern')->visibleToSupervisor($request->user())->where('status', 'active')
            ->whereHas('intern', fn ($q) => $q->where('status', 'pending_activation'))->get()
            ->map(fn ($d) => $d->intern?->name)->filter()->values();

        return response()->json(['tasks' => $tasks, 'interns' => $this->internOptions($request->user()), 'not_set_up' => $notSetUp]);
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
            'evaluation' => $t->evaluation ? [
                'rating' => (float) $t->evaluation->rating,
                'comments' => $t->evaluation->comments,
                'evaluated_at' => $t->evaluation->evaluated_at?->local()?->format('M d, Y'),
            ] : null,
            'subtask_total' => $t->subtasks->count(),
            'subtask_done' => $t->subtasks->where('status', 'completed')->count(),
        ];
    }

    private function taskForSupervisor(int $taskId, User $user): ?Task
    {
        return Task::visibleToSupervisor($user)->find($taskId);
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
            'due_date' => 'nullable|date',
            'leader_id' => 'nullable|integer',
        ]);

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

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'due_date' => 'nullable|date',
            'assignee_ids' => 'nullable|array',
            'assignee_ids.*' => 'integer',
        ]);

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

        $query = Attendance::with('deployment.intern')
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('attendance_date')
            ->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

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
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
                'status' => $a->status,
                // A time-out the system filled in (the intern forgot) can be corrected by the supervisor.
                'edited' => $a->edited_at !== null,
                'can_edit_times' => ($a->auto_clocked_out || $a->edited_at !== null) && $a->clock_in && $a->clock_out,
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
            'attendance_date' => 'required|date',
            'clock_in' => 'nullable|date_format:H:i',
            'clock_out' => 'nullable|date_format:H:i|after:clock_in',
            // Afternoon, for companies that record morning and afternoon separately.
            'pm_in' => 'nullable|date_format:H:i|after:clock_out',
            'pm_out' => 'nullable|date_format:H:i|after:pm_in',
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        // A supervisor logging attendance was there to see it happen — no
        // separate approval step needed, unlike a record entered secondhand.
        // The times typed here are Philippine wall-clock times; storage is UTC.
        $at = fn (?string $hm) => $hm ? Carbon::parse("{$data['attendance_date']} {$hm}", LocalTime::tz())->utc() : null;
        $split = !empty($data['pm_in']) || !empty($data['pm_out']);
        $attendance = Attendance::create([
            'deployment_id' => $deployment->id,
            'attendance_date' => $data['attendance_date'],
            'session' => $split ? Attendance::AM : Attendance::FULL,
            'clock_in' => $at($data['clock_in'] ?? null),
            'clock_out' => $at($data['clock_out'] ?? null),
            'status' => 'approved',
        ]);
        if ($split) {
            Attendance::create([
                'deployment_id' => $deployment->id,
                'attendance_date' => $data['attendance_date'],
                'session' => Attendance::PM,
                'clock_in' => $at($data['pm_in'] ?? null),
                'clock_out' => $at($data['pm_out'] ?? null),
                'status' => 'approved',
            ]);
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
     * The intern forgot to time out, so the system closed the shift at its longest length. The
     * supervisor knows when they really left: this sets the true time in and out, and the hours are
     * recomputed. A correction can only shorten a shift, never make it longer than the system's cap.
     */
    public function updateAttendanceTimes(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'clock_in' => 'required|date_format:H:i',
            'clock_out' => 'required|date_format:H:i',
        ]);

        $attendance = Attendance::with('deployment.intern')
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))
            ->find($id);
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Attendance record not found.'], 404);
        }
        if (!$attendance->auto_clocked_out && $attendance->edited_at === null) {
            return response()->json(['success' => false, 'message' => 'Only a time-out the system closed automatically can be corrected.'], 422);
        }

        // The times typed are Philippine wall-clock times on the day of the shift; storage is UTC.
        $day = $attendance->clock_in ? LocalTime::date($attendance->clock_in) : $attendance->attendance_date->toDateString();
        $in = Carbon::parse("{$day} {$data['clock_in']}", LocalTime::tz())->utc();
        $out = Carbon::parse("{$day} {$data['clock_out']}", LocalTime::tz())->utc();
        if ($out->lte($in)) {
            return response()->json(['success' => false, 'message' => 'The time out must be after the time in.', 'errors' => ['clock_out' => ['The time out must be after the time in.']]], 422);
        }
        $max = Attendance::maxHoursFor($attendance->session);
        if ($in->diffInMinutes($out) > $max * 60) {
            return response()->json(['success' => false, 'message' => "A shift here can be at most {$max} hours long.", 'errors' => ['clock_out' => ["At most {$max} hours."]]], 422);
        }

        $attendance->update([
            'clock_in' => $in,
            'clock_out' => $out,
            'auto_clocked_out' => false,
            'edited_by' => $request->user()->id,
            'edited_at' => now(),
        ]);

        $hours = round($in->diffInMinutes($out) / 60, 1);
        $deployment = $attendance->deployment;
        if ($deployment) {
            NotificationService::toUser(
                'intern', $deployment->intern_id, $deployment->school_id, 'attendance_edited', 'Your attendance time was corrected',
                "{$attendance->attendance_date->format('M d, Y')}: {$in->local()->format('h:i A')} to {$out->local()->format('h:i A')} ({$hours}h).",
                '/intern/attendance'
            );
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Corrected attendance time',
            description: "Attendance #{$attendance->id} on {$attendance->attendance_date->format('M d, Y')} set to {$in->local()->format('h:i A')} - {$out->local()->format('h:i A')} ({$hours}h).",
            schoolId: $deployment?->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Time corrected.', 'hours' => $hours]);
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
        $supervisorId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForSupervisor($request->user());

        $query = Evaluation::with(['deployment.intern', 'evaluator', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date');

        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        $evaluations = $query->get()->map(fn (Evaluation $e) => $this->mapEvaluation($e));

        return response()->json(['evaluations' => $evaluations, 'interns' => $this->internOptions($request->user())]);
    }

    private function mapEvaluation(Evaluation $e): array
    {
        return [
            'id' => $e->id,
            'deployment_id' => $e->deployment_id,
            'intern_name' => trim("{$e->deployment?->intern?->first_name} {$e->deployment?->intern?->last_name}") ?: $e->deployment?->intern?->name,
            'evaluator_name' => $e->evaluator?->name,
            'evaluation_type' => $e->evaluation_type,
            'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
            'overall_score' => $e->overall_score,
            'remarks' => $e->remarks,
            'category_comments' => $e->category_comments ?? [],
            'status' => $e->status,
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

    public function storeEvaluation(Request $request): JsonResponse
    {
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::FORMAL_EVALUATIONS)) {
            return response()->json(['success' => false, 'message' => 'Formal, criteria-based evaluations aren\'t included in your school\'s current plan. Use the manual evaluation instead.'], 403);
        }

        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'evaluation_type' => 'required|string|max:100',
            'evaluation_date' => 'required|date',
            'remarks' => 'nullable|string|max:1000',
            'category_comments' => 'nullable|array',
            'category_comments.*' => 'nullable|string|max:500',
            'scores' => 'required|array|min:1',
            'scores.*.criteria_id' => 'required|integer|exists:evaluation_criteria,id',
            'scores.*.score' => 'required|numeric|min:0',
            'scores.*.remarks' => 'nullable|string|max:500',
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        $criteria = EvaluationCriterion::whereIn('id', collect($data['scores'])->pluck('criteria_id'))
            ->where('school_id', $schoolId)
            ->get()
            ->keyBy('id');

        if ($criteria->count() !== count($data['scores'])) {
            return response()->json(['success' => false, 'message' => 'One or more criteria do not belong to your school.'], 422);
        }

        $totalWeight = $criteria->sum('weight');
        $weightedSum = 0;
        foreach ($data['scores'] as $s) {
            $criterion = $criteria->get($s['criteria_id']);
            $normalized = $criterion->max_score > 0 ? ($s['score'] / $criterion->max_score) * 100 : 0;
            $weightedSum += $normalized * $criterion->weight;
        }
        $overallScore = $totalWeight > 0 ? round($weightedSum / $totalWeight, 2) : null;

        $evaluation = Evaluation::create([
            'deployment_id' => $deployment->id,
            'evaluator_id' => $supervisorId,
            'evaluation_type' => $data['evaluation_type'],
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

        ActivityLogService::record(
            module: 'Evaluations',
            action: 'Submitted evaluation',
            description: "{$data['evaluation_type']} evaluation for {$deployment->intern?->name} — score {$overallScore}.",
            schoolId: $schoolId,
            request: $request
        );

        NotificationService::toUser(
            'intern',
            $deployment->intern_id,
            $schoolId,
            'evaluation_submitted',
            'New evaluation received',
            "{$data['evaluation_type']} evaluation — overall score {$overallScore}%.",
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
            'evaluation_date' => 'required|date',
            'overall_score' => 'required|numeric|min:0|max:100',
            'remarks' => 'nullable|string|max:2000',
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $request->user());
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }

        $evaluation = Evaluation::create([
            'deployment_id' => $deployment->id,
            'evaluator_id' => $supervisorId,
            'evaluation_type' => 'Manual',
            'evaluation_date' => $data['evaluation_date'],
            'overall_score' => $data['overall_score'],
            'remarks' => $data['remarks'] ?? null,
            'status' => 'submitted',
        ]);

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

        $activities = $query->get()->map(fn (DailyActivity $a) => [
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

        return response()->json(['activities' => $activities, 'interns' => $this->internOptions($request->user())]);
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
            'ids' => 'required|array|min:1|max:500',
            'ids.*' => 'integer',
        ]);

        $activities = DailyActivity::with('deployment.intern')
            ->whereIn('deployment_id', $this->deploymentIdsForSupervisor($request->user()))
            ->whereIn('id', $data['ids'])
            ->where('status', DailyActivity::PENDING)
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
