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
use App\Models\Subtask;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\TaskEvaluation;
use App\Models\TaskProof;
use App\Services\ActivityLogService;
use App\Services\DeploymentSummaryService;
use App\Services\NotificationService;
use App\Services\TaskRatingAverage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * A supervisor only ever sees the interns actually assigned to them
 * (deployment.supervisor_id = the logged-in user) — never their whole
 * school's roster the way a coordinator does. Attendance is the one thing
 * a supervisor can log/approve that a coordinator can't: they're the one
 * who's actually there to see whether the intern showed up.
 */
class SupervisorMonitoringController extends Controller
{
    private function deploymentIdsForSupervisor(int $supervisorId): array
    {
        return InternshipDeployment::where('supervisor_id', $supervisorId)->pluck('id')->all();
    }

    private function deploymentForSupervisor(int $deploymentId, int $supervisorId): ?InternshipDeployment
    {
        return InternshipDeployment::where('id', $deploymentId)->where('supervisor_id', $supervisorId)->first();
    }

    public function interns(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $deployments = InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('supervisor_id', $supervisorId)
            ->orderByDesc('id')
            ->get();

        $profiles = InternProfile::where('school_id', $schoolId)->get()->keyBy('user_id');

        $interns = $deployments->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)));

        return response()->json(['interns' => $interns->values()]);
    }

    public function tasks(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;

        $query = Task::with(['assignees.user', 'subtasks', 'evaluation'])->where('assigned_by', $supervisorId)->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t));

        return response()->json(['tasks' => $tasks, 'interns' => $this->internOptions($supervisorId)]);
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
            'created_at' => $t->created_at->format('M d, Y'),
            'completed_at' => $t->completed_at?->format('M d, Y'),
            'evaluation' => $t->evaluation ? [
                'rating' => (float) $t->evaluation->rating,
                'comments' => $t->evaluation->comments,
                'evaluated_at' => $t->evaluation->evaluated_at?->format('M d, Y'),
            ] : null,
            'subtask_total' => $t->subtasks->count(),
            'subtask_done' => $t->subtasks->where('status', 'completed')->count(),
        ];
    }

    private function taskForSupervisor(int $taskId, int $supervisorId): ?Task
    {
        return Task::where('assigned_by', $supervisorId)->find($taskId);
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
        $deployments = InternshipDeployment::where('supervisor_id', $supervisorId)
            ->whereIn('id', $data['deployment_ids'])
            ->get();

        if ($deployments->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'Select at least one intern you supervise.'], 422);
        }

        // A leader only makes sense on a group task, and has to actually be
        // one of the interns being assigned — silently ignored otherwise
        // rather than trusting a stray id from the client.
        $leaderId = null;
        if (!empty($data['leader_id']) && $deployments->count() > 1 && $deployments->contains('intern_id', $data['leader_id'])) {
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
        $task = $this->taskForSupervisor($id, $supervisorId);
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
        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($id, $supervisorId);
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
            'created_at' => $p->created_at->format('M d, Y g:i A'),
        ];
    }

    private function mapComment(TaskComment $c): array
    {
        return [
            'id' => $c->id,
            'comment' => $c->comment,
            'author_name' => $c->user?->name,
            'created_at' => $c->created_at->format('M d, Y g:i A'),
        ];
    }

    public function storeSubtask(Request $request, int $taskId): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($taskId, $supervisorId);
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

        // A subtask can go to several members of a group task at once —
        // default to the sole assignee when the task isn't a group task.
        $requestedIds = $data['assignee_ids'] ?? [];
        if (empty($requestedIds) && $task->assignees->count() === 1) {
            $requestedIds = [$task->assignees->first()->user_id];
        }
        $validIds = $task->assignees->pluck('user_id')->intersect($requestedIds)->values();
        if ($validIds->count() !== count(array_unique($requestedIds))) {
            return response()->json(['success' => false, 'message' => 'One or more selected interns are not assigned to this task.'], 422);
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
        $subtask = $this->subtaskForSupervisor($id, $supervisorId);
        if (!$subtask) {
            return response()->json(['success' => false, 'message' => 'Subtask not found.'], 404);
        }

        $task = $subtask->task;
        $subtask->delete();
        $task->recalculateStatusFromSubtasks();

        return response()->json(['success' => true, 'message' => 'Subtask removed.']);
    }

    private function subtaskForSupervisor(int $subtaskId, int $supervisorId): ?Subtask
    {
        return Subtask::whereHas('task', fn ($q) => $q->where('assigned_by', $supervisorId))->find($subtaskId);
    }

    public function storeTaskComment(Request $request, int $taskId): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $task = $this->taskForSupervisor($taskId, $supervisorId);
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
        $subtask = $this->subtaskForSupervisor($subtaskId, $supervisorId);
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
        $deploymentIds = $this->deploymentIdsForSupervisor($supervisorId);

        $query = Attendance::with('deployment.intern')
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('attendance_date');

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
                'clock_in' => $a->clock_in?->format('h:i A'),
                'clock_in_selfie_url' => $a->clock_in_selfie_path ? Storage::disk('public')->url($a->clock_in_selfie_path) : null,
                'clock_in_location' => $a->clock_in_latitude !== null ? ['lat' => $a->clock_in_latitude, 'lng' => $a->clock_in_longitude] : null,
                'clock_out' => $a->clock_out?->format('h:i A'),
                'clock_out_selfie_url' => $a->clock_out_selfie_path ? Storage::disk('public')->url($a->clock_out_selfie_path) : null,
                'clock_out_location' => $a->clock_out_latitude !== null ? ['lat' => $a->clock_out_latitude, 'lng' => $a->clock_out_longitude] : null,
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
                'status' => $a->status,
            ]),
            'total' => $records->total(),
            'page' => $records->currentPage(),
            'has_more' => $records->hasMorePages(),
            'interns' => $this->internOptions($supervisorId),
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
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $supervisorId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not assigned to you.'], 404);
        }

        // A supervisor logging attendance was there to see it happen — no
        // separate approval step needed, unlike a record entered secondhand.
        $attendance = Attendance::create([
            'deployment_id' => $deployment->id,
            'attendance_date' => $data['attendance_date'],
            'clock_in' => $data['clock_in'] ? "{$data['attendance_date']} {$data['clock_in']}" : null,
            'clock_out' => $data['clock_out'] ? "{$data['attendance_date']} {$data['clock_out']}" : null,
            'status' => 'approved',
        ]);

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Logged attendance',
            description: "Attendance logged for {$deployment->intern?->name} on {$data['attendance_date']}.",
            schoolId: $deployment->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Attendance logged.', 'id' => $attendance->id]);
    }

    public function reviewAttendance(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $data = $request->validate(['status' => 'required|string|in:approved,rejected']);

        $attendance = Attendance::whereIn('deployment_id', $this->deploymentIdsForSupervisor($supervisorId))->find($id);
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

    private function internOptions(int $supervisorId): array
    {
        return InternshipDeployment::with('intern')
            ->where('supervisor_id', $supervisorId)
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
        $deploymentIds = $this->deploymentIdsForSupervisor($supervisorId);

        $query = Evaluation::with(['deployment.intern', 'evaluator', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date');

        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        $evaluations = $query->get()->map(fn (Evaluation $e) => $this->mapEvaluation($e));

        return response()->json(['evaluations' => $evaluations, 'interns' => $this->internOptions($supervisorId)]);
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
        $supervisorId = $request->user()->id;
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'evaluation_type' => 'required|string|max:100',
            'evaluation_date' => 'required|date',
            'remarks' => 'nullable|string|max:1000',
            'category_comments' => 'nullable|array',
            'scores' => 'required|array|min:1',
            'scores.*.criteria_id' => 'required|integer|exists:evaluation_criteria,id',
            'scores.*.score' => 'required|numeric|min:0',
            'scores.*.remarks' => 'nullable|string|max:500',
        ]);

        $deployment = $this->deploymentForSupervisor($data['deployment_id'], $supervisorId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not assigned to you.'], 404);
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

    // ---------------------------------------------------------------
    // Daily activities — the intern's own narrative log (see
    // InternMonitoringController::activities/storeActivity); a supervisor
    // only ever reviews entries from interns actually deployed to them.
    // ---------------------------------------------------------------

    public function activities(Request $request): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForSupervisor($supervisorId);

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
            'hours_rendered' => (float) $a->hours_rendered,
            'photo_url' => $a->photo_path ? Storage::disk('public')->url($a->photo_path) : null,
            'status' => $a->status,
            'review_remarks' => $a->review_remarks,
        ]);

        return response()->json(['activities' => $activities, 'interns' => $this->internOptions($supervisorId)]);
    }

    public function reviewActivity(Request $request, int $id): JsonResponse
    {
        $supervisorId = $request->user()->id;
        $data = $request->validate([
            'status' => 'required|string|in:approved,rejected',
            'review_remarks' => 'nullable|string|max:500',
        ]);

        $activity = DailyActivity::whereIn('deployment_id', $this->deploymentIdsForSupervisor($supervisorId))->find($id);
        if (!$activity) {
            return response()->json(['success' => false, 'message' => 'Activity entry not found.'], 404);
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
}
