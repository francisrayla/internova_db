<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\EvaluationScore;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Portfolio;
use App\Models\PortfolioItem;
use App\Models\Subtask;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\TaskProof;
use App\Services\ActivityLogService;
use App\Services\DeploymentSummaryService;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * An intern only ever sees their own record — tasks they're assigned to
 * (individually or as part of a group a supervisor put together) and their
 * own attendance history. They drag subtasks across Pending/Ongoing/Done as
 * the actual work happens; a task with no subtasks falls back to a plain
 * status they set directly. Attendance is self-reported here (clock in/out
 * with a selfie + GPS coordinates as the verification evidence) but always
 * lands as "pending" — the supervisor still reviews the selfie/location
 * before it counts as approved (see SupervisorMonitoringController), so
 * self-reporting never bypasses verification, it just supplies the proof.
 */
class InternMonitoringController extends Controller
{
    private function deploymentIdsForIntern(int $internId): array
    {
        return InternshipDeployment::where('intern_id', $internId)->pluck('id')->all();
    }

    /**
     * The deployment the profile screen's widgets should reflect — prefers
     * the currently active one so a finished/cancelled past deployment
     * doesn't shadow it; falls back to the most recent deployment on record
     * so an intern between placements still sees their last standing.
     */
    private function currentDeploymentFor(int $internId): ?InternshipDeployment
    {
        return InternshipDeployment::where('intern_id', $internId)->where('status', 'active')->latest('start_date')->first()
            ?? InternshipDeployment::where('intern_id', $internId)->latest('start_date')->first();
    }

    /**
     * One call for everything the profile screen's summary cards need —
     * hours/task progress reuse the exact same math the coordinator and
     * supervisor already see for this intern (DeploymentSummaryService), so
     * the numbers never drift between what the intern sees of themselves
     * and what their supervisor/coordinator sees of them.
     */
    public function profileSummary(Request $request): JsonResponse
    {
        $intern = $request->user();
        $deployment = $this->currentDeploymentFor($intern->id);

        if (!$deployment) {
            return response()->json([
                'has_deployment' => false,
                'evaluations_count' => 0,
                'last_activity_date' => null,
                'has_activity_today' => false,
            ]);
        }

        $profile = InternProfile::where('user_id', $intern->id)->first();
        $summary = DeploymentSummaryService::summarize($deployment, $profile);

        $evaluationsCount = Evaluation::where('deployment_id', $deployment->id)->count();
        $lastActivityDate = DailyActivity::where('deployment_id', $deployment->id)->max('activity_date');
        $hasActivityToday = DailyActivity::where('deployment_id', $deployment->id)
            ->whereDate('activity_date', now()->toDateString())
            ->exists();

        return response()->json([
            'has_deployment' => true,
            ...$summary,
            'evaluations_count' => $evaluationsCount,
            'last_activity_date' => $lastActivityDate ? Carbon::parse($lastActivityDate)->format('M d, Y') : null,
            'has_activity_today' => $hasActivityToday,
        ]);
    }

    public function tasks(Request $request): JsonResponse
    {
        $internId = $request->user()->id;

        $query = Task::with(['company', 'assignees.user', 'subtasks', 'evaluation'])
            ->whereHas('assignees', fn ($q) => $q->where('user_id', $internId))
            ->orderByDesc('id');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t, $internId));

        return response()->json(['tasks' => $tasks]);
    }

    private function mapTaskRow(Task $t, int $internId): array
    {
        $assignees = $t->assignees->map(fn (TaskAssignee $a) => [
            'user_id' => $a->user_id,
            'name' => trim("{$a->user?->first_name} {$a->user?->last_name}") ?: $a->user?->name,
        ]);

        return [
            'id' => $t->id,
            'company_name' => $t->company?->company_name,
            'assignees' => $assignees,
            'is_group' => $assignees->count() > 1,
            // A solo task has no leader concept — only a group task, and only
            // if this intern is the one the supervisor designated. Drives
            // whether "+ Add subtask" shows up for this intern (see
            // TaskDetailView's canAddSubtask).
            'is_leader' => $assignees->count() > 1 && $t->leader_id === $internId,
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

    private function taskForIntern(int $taskId, int $internId): ?Task
    {
        return Task::whereHas('assignees', fn ($q) => $q->where('user_id', $internId))->find($taskId);
    }

    public function taskShow(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $task = $this->taskForIntern($id, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $task->load(['assignedBy', 'company', 'assignees.user', 'subtasks.assignees', 'subtasks.comments.user', 'subtasks.proofs.uploader', 'comments.user', 'evaluation', 'proofs.uploader']);

        return response()->json(['task' => [
            ...$this->mapTaskRow($task, $internId),
            'assigned_by_name' => $task->assignedBy?->name,
            'comments' => $task->comments->map(fn (TaskComment $c) => $this->mapComment($c)),
            'proofs' => $task->proofs->map(fn (TaskProof $p) => $this->mapProof($p)),
            'subtasks' => $task->subtasks->map(fn (Subtask $s) => [
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
        ]]);
    }

    private function mapSubtaskAssignees(Subtask $s): array
    {
        return $s->assignees->map(fn ($u) => [
            'user_id' => $u->id,
            'name' => trim("{$u->first_name} {$u->last_name}") ?: $u->name,
        ])->values()->all();
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

    /**
     * Files are stored per-task/subtask under a shared "proofs" prefix so a
     * completion always has at least one piece of evidence attached before
     * the status itself flips — see completeTask/completeSubtask below.
     */
    private function storeProofFiles(Request $request, ?int $taskId, ?int $subtaskId, int $uploaderId): void
    {
        $folder = $taskId ? "task-proofs/task-{$taskId}" : "task-proofs/subtask-{$subtaskId}";
        foreach ($request->file('proofs', []) as $file) {
            $path = $file->store($folder, 'public');
            TaskProof::create([
                'task_id' => $taskId,
                'subtask_id' => $subtaskId,
                'uploaded_by' => $uploaderId,
                'file_path' => $path,
                'file_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getClientMimeType(),
                'size' => $file->getSize(),
            ]);
        }
    }

    /**
     * A group task's own overall status — direct status changes or marking
     * it done outright — is the leader's call only, same permission as
     * adding subtasks (see storeSubtask). A solo task's sole assignee
     * always has this since there's no one else on the task to defer to.
     */
    private function canManageTaskStatus(Task $task, int $internId): bool
    {
        $task->loadMissing('assignees');

        return $task->assignees->count() <= 1 || $task->leader_id === $internId;
    }

    /**
     * Only usable when the task has zero subtasks — once subtasks exist,
     * the task's status is derived from them (see
     * Task::recalculateStatusFromSubtasks) and this is rejected so the two
     * mechanisms can't fight each other. Marking something "completed" is
     * rejected here too — that always goes through completeTask() below,
     * since a completion needs proof attached before the status can flip.
     */
    public function updateTask(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $data = $request->validate(['status' => 'required|string|in:pending,in_progress,completed']);

        $task = $this->taskForIntern($id, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }
        if ($task->subtasks()->exists()) {
            return response()->json(['success' => false, 'message' => 'This task has subtasks — drag them to update progress instead.'], 422);
        }
        if (!$this->canManageTaskStatus($task, $internId)) {
            return response()->json(['success' => false, 'message' => 'Only the task leader can update this group task\'s status.'], 403);
        }
        if ($data['status'] === 'completed') {
            return response()->json(['success' => false, 'message' => 'Upload proof to mark this task as done.'], 422);
        }

        $task->setStatus($data['status']);

        return response()->json(['success' => true, 'message' => 'Task updated.']);
    }

    /**
     * Marking a task done requires at least one proof file (photo or
     * document) — the modal on the frontend collects it before ever calling
     * this, so by the time we're here the intern has already confirmed.
     * A task with subtasks doesn't auto-complete once they're all done (see
     * Task::recalculateStatusFromSubtasks) — the leader still has to come
     * here and explicitly close it out, proof and all, once every subtask
     * is done.
     */
    public function completeTask(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $task = $this->taskForIntern($id, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $task->loadMissing('subtasks');
        if ($task->subtasks->isNotEmpty() && $task->subtasks->contains(fn (Subtask $s) => $s->status !== 'completed')) {
            return response()->json(['success' => false, 'message' => 'Finish every subtask before marking the whole task done.'], 422);
        }
        if (!$this->canManageTaskStatus($task, $internId)) {
            return response()->json(['success' => false, 'message' => 'Only the task leader can mark this group task as done.'], 403);
        }
        if ($task->status === 'completed') {
            return response()->json(['success' => false, 'message' => 'This task is already done.'], 422);
        }

        $request->validate([
            'proofs' => 'required|array|min:1',
            'proofs.*' => 'file|mimes:jpg,jpeg,png,pdf,doc,docx,xls,xlsx,ppt,pptx|max:15360',
        ]);

        $this->storeProofFiles($request, $task->id, null, $internId);
        $task->setStatus('completed');

        return response()->json(['success' => true, 'message' => 'Task marked done.']);
    }

    private function subtaskForIntern(int $subtaskId, int $internId): ?Subtask
    {
        return Subtask::whereHas('task.assignees', fn ($q) => $q->where('user_id', $internId))->find($subtaskId);
    }

    /**
     * An intern can break their own task into subtasks — on a solo task
     * that's just them, no group to coordinate. On a group task, only the
     * one member the supervisor designated as leader gets this (see
     * Task::leader_id) — everyone else on the group just works whatever
     * subtask lands on them. The supervisor can always add subtasks too,
     * leader or not (see SupervisorMonitoringController::storeSubtask).
     */
    public function storeSubtask(Request $request, int $taskId): JsonResponse
    {
        $internId = $request->user()->id;
        $task = $this->taskForIntern($taskId, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        if (!$this->canManageTaskStatus($task, $internId)) {
            return response()->json(['success' => false, 'message' => 'Only the task leader can add subtasks for this group.'], 403);
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

    public function updateSubtask(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $subtask = $this->subtaskForIntern($id, $internId);
        if (!$subtask) {
            return response()->json(['success' => false, 'message' => 'Subtask not found.'], 404);
        }

        $data = $request->validate(['status' => 'required|string|in:pending,in_progress,completed']);
        if ($data['status'] === 'completed') {
            return response()->json(['success' => false, 'message' => 'Upload proof to mark this subtask as done.'], 422);
        }

        $subtask->update([
            'status' => $data['status'],
            'completed_at' => null,
        ]);

        $subtask->task->recalculateStatusFromSubtasks();

        return response()->json(['success' => true, 'message' => 'Subtask updated.']);
    }

    /**
     * Same proof-before-completion gate as completeTask(), one level down.
     */
    public function completeSubtask(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $subtask = $this->subtaskForIntern($id, $internId);
        if (!$subtask) {
            return response()->json(['success' => false, 'message' => 'Subtask not found.'], 404);
        }
        if ($subtask->status === 'completed') {
            return response()->json(['success' => false, 'message' => 'This subtask is already done.'], 422);
        }

        $request->validate([
            'proofs' => 'required|array|min:1',
            'proofs.*' => 'file|mimes:jpg,jpeg,png,pdf,doc,docx,xls,xlsx,ppt,pptx|max:15360',
        ]);

        $this->storeProofFiles($request, null, $subtask->id, $internId);
        $subtask->update(['status' => 'completed', 'completed_at' => now()]);
        $subtask->task->recalculateStatusFromSubtasks();

        return response()->json(['success' => true, 'message' => 'Subtask marked done.']);
    }

    public function storeTaskComment(Request $request, int $taskId): JsonResponse
    {
        $internId = $request->user()->id;
        $task = $this->taskForIntern($taskId, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        $data = $request->validate(['comment' => 'required|string|max:2000']);

        $comment = $task->comments()->create([
            'user_id' => $request->user()->id,
            'comment' => $data['comment'],
        ]);
        $comment->load('user');

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    public function storeSubtaskComment(Request $request, int $subtaskId): JsonResponse
    {
        $internId = $request->user()->id;
        $subtask = $this->subtaskForIntern($subtaskId, $internId);
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

        return response()->json(['success' => true, 'comment' => $this->mapComment($comment)]);
    }

    private function mapAttendance(Attendance $a): array
    {
        return [
            'id' => $a->id,
            'attendance_date' => $a->attendance_date?->format('M d, Y'),
            'clock_in' => $a->clock_in?->format('h:i A'),
            'clock_in_selfie_url' => $a->clock_in_selfie_path ? Storage::disk('public')->url($a->clock_in_selfie_path) : null,
            'clock_in_location' => $a->clock_in_latitude !== null ? ['lat' => $a->clock_in_latitude, 'lng' => $a->clock_in_longitude] : null,
            'clock_out' => $a->clock_out?->format('h:i A'),
            'clock_out_selfie_url' => $a->clock_out_selfie_path ? Storage::disk('public')->url($a->clock_out_selfie_path) : null,
            'clock_out_location' => $a->clock_out_latitude !== null ? ['lat' => $a->clock_out_latitude, 'lng' => $a->clock_out_longitude] : null,
            'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
            'status' => $a->status,
        ];
    }

    public function attendance(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $records = Attendance::whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('attendance_date')
            ->paginate(20);

        return response()->json([
            'records' => collect($records->items())->map(fn (Attendance $a) => $this->mapAttendance($a)),
            'total' => $records->total(),
            'page' => $records->currentPage(),
            'has_more' => $records->hasMorePages(),
        ]);
    }

    /**
     * Today's in-progress attendance record (or null) plus which action —
     * clock in or clock out — the intern should see next. Kept separate from
     * the paginated history so the "clock in/out" widget doesn't have to
     * hunt through a page of past records to figure out today's state.
     */
    public function attendanceToday(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['record' => null, 'next_action' => null]);
        }

        $record = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', now()->toDateString())
            ->first();

        $nextAction = !$record || !$record->clock_in ? 'clock_in' : (!$record->clock_out ? 'clock_out' : null);

        return response()->json([
            'record' => $record ? $this->mapAttendance($record) : null,
            'next_action' => $nextAction,
        ]);
    }

    private function selfieAndLocation(Request $request): array
    {
        $data = $request->validate([
            'selfie' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
        ]);

        return $data;
    }

    public function clockIn(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to clock in.'], 422);
        }

        $today = now()->toDateString();
        $existing = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', $today)
            ->first();
        if ($existing && $existing->clock_in) {
            return response()->json(['success' => false, 'message' => 'You already clocked in today.'], 422);
        }

        $data = $this->selfieAndLocation($request);
        $selfiePath = $request->file('selfie')->store("attendance-selfies/deployment-{$deployment->id}", 'public');

        $attendance = $existing ?? new Attendance(['deployment_id' => $deployment->id, 'attendance_date' => $today]);
        $attendance->fill([
            'clock_in' => now(),
            'clock_in_selfie_path' => $selfiePath,
            'clock_in_latitude' => $data['latitude'],
            'clock_in_longitude' => $data['longitude'],
            'status' => 'pending',
        ]);
        $attendance->save();

        if ($deployment->supervisor_id) {
            NotificationService::toUser(
                'supervisor',
                $deployment->supervisor_id,
                $deployment->school_id,
                'attendance_logged',
                'New attendance to review',
                "{$request->user()->name} clocked in for {$attendance->attendance_date->format('M d, Y')}.",
                '/supervisor/attendance'
            );
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Clocked in',
            description: "{$request->user()->name} clocked in on {$attendance->attendance_date->format('M d, Y')}.",
            schoolId: $deployment->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Clocked in.', 'record' => $this->mapAttendance($attendance)]);
    }

    public function clockOut(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to clock out.'], 422);
        }

        $attendance = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', now()->toDateString())
            ->first();
        if (!$attendance || !$attendance->clock_in) {
            return response()->json(['success' => false, 'message' => 'Clock in first.'], 422);
        }
        if ($attendance->clock_out) {
            return response()->json(['success' => false, 'message' => 'You already clocked out today.'], 422);
        }

        $data = $this->selfieAndLocation($request);
        $selfiePath = $request->file('selfie')->store("attendance-selfies/deployment-{$deployment->id}", 'public');

        $attendance->update([
            'clock_out' => now(),
            'clock_out_selfie_path' => $selfiePath,
            'clock_out_latitude' => $data['latitude'],
            'clock_out_longitude' => $data['longitude'],
            'status' => 'pending',
        ]);

        if ($deployment->supervisor_id) {
            NotificationService::toUser(
                'supervisor',
                $deployment->supervisor_id,
                $deployment->school_id,
                'attendance_logged',
                'Attendance ready for review',
                "{$request->user()->name} clocked out for {$attendance->attendance_date->format('M d, Y')}.",
                '/supervisor/attendance'
            );
        }

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Clocked out',
            description: "{$request->user()->name} clocked out on {$attendance->attendance_date->format('M d, Y')}.",
            schoolId: $deployment->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Clocked out.', 'record' => $this->mapAttendance($attendance)]);
    }

    private function mapActivity(DailyActivity $a): array
    {
        return [
            'id' => $a->id,
            'activity_date' => $a->activity_date?->format('M d, Y'),
            'title' => $a->title,
            'description' => $a->description,
            'hours_rendered' => (float) $a->hours_rendered,
            'photo_url' => $a->photo_path ? Storage::disk('public')->url($a->photo_path) : null,
            'status' => $a->status,
            'review_remarks' => $a->review_remarks,
        ];
    }

    /**
     * The intern's own daily narrative log — one entry per accomplishment
     * they choose to record, most recent first. A supervisor reviews these
     * (status/review_remarks) elsewhere; here the intern only ever reads
     * and adds their own.
     */
    public function activities(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $activities = DailyActivity::whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('activity_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (DailyActivity $a) => $this->mapActivity($a));

        return response()->json(['activities' => $activities]);
    }

    public function storeActivity(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to log activities.'], 422);
        }

        $data = $request->validate([
            'activity_date' => 'nullable|date',
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:4000',
            'hours_rendered' => 'nullable|numeric|min:0|max:24',
            'photo' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        $photoPath = null;
        if ($request->hasFile('photo')) {
            $photoPath = $request->file('photo')->store("activity-photos/deployment-{$deployment->id}", 'public');
        }

        $activity = DailyActivity::create([
            'deployment_id' => $deployment->id,
            'activity_date' => $data['activity_date'] ?? now()->toDateString(),
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'hours_rendered' => $data['hours_rendered'] ?? 0,
            'photo_path' => $photoPath,
            'status' => 'pending',
        ]);

        return response()->json(['success' => true, 'activity' => $this->mapActivity($activity)]);
    }

    /**
     * Read-only — the supervisor is the one who fills these in (see
     * SupervisorMonitoringController), the intern just gets to see their
     * own feedback and score once it's submitted.
     */
    public function evaluations(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $evaluations = Evaluation::with(['evaluator', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date')
            ->get()
            ->map(fn (Evaluation $e) => [
                'id' => $e->id,
                'evaluator_name' => $e->evaluator?->name,
                'evaluation_type' => $e->evaluation_type,
                'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
                'overall_score' => $e->overall_score,
                'remarks' => $e->remarks,
                'category_comments' => $e->category_comments ?? [],
                'scores' => $e->scores->map(fn (EvaluationScore $s) => [
                    'category' => $s->criterion?->category,
                    'criterion_name' => $s->criterion?->name,
                    'score' => $s->score,
                    'max_score' => $s->criterion?->max_score,
                    'remarks' => $s->remarks,
                ]),
            ]);

        return response()->json(['evaluations' => $evaluations]);
    }

    // ---------------------------------------------------------------
    // Documents — everything on file for this intern, plus the intern's
    // own uploads (a coordinator can also upload on their behalf, see
    // CoordinatorMonitoringController).
    // ---------------------------------------------------------------

    private function mapDocument(Document $d): array
    {
        return [
            'id' => $d->id,
            'document_type' => $d->document_type,
            'file_name' => $d->file_name,
            'file_url' => Storage::disk('public')->url($d->file_path),
            'status' => $d->status,
            'remarks' => $d->remarks,
            'uploaded_at' => $d->created_at->format('M d, Y'),
        ];
    }

    public function documents(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $documents = Document::whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('id')
            ->get()
            ->map(fn (Document $d) => $this->mapDocument($d));

        return response()->json(['documents' => $documents]);
    }

    public function storeDocument(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to upload documents.'], 422);
        }

        $data = $request->validate([
            'document_type' => 'required|string|max:100',
            'file' => 'required|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:5120',
        ]);

        $schoolId = $request->user()->school_id;
        $path = $request->file('file')->store("documents/{$schoolId}", 'public');

        $document = Document::create([
            'deployment_id' => $deployment->id,
            'uploaded_by' => $internId,
            'document_type' => $data['document_type'],
            'file_name' => $request->file('file')->getClientOriginalName(),
            'file_path' => $path,
            'status' => 'pending',
        ]);

        ActivityLogService::record(
            module: 'Documents',
            action: 'Uploaded document',
            description: "{$data['document_type']} uploaded by {$request->user()->name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'document' => $this->mapDocument($document)]);
    }

    // ---------------------------------------------------------------
    // Portfolio — one row per intern, auto-created on first visit; items
    // are simple showcase entries. No approval workflow — purely
    // self-authored and self-published via is_public.
    // ---------------------------------------------------------------

    private function mapPortfolio(Portfolio $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'bio' => $p->bio,
            'is_public' => (bool) $p->is_public,
            'items' => $p->items->map(fn (PortfolioItem $i) => [
                'id' => $i->id,
                'title' => $i->title,
                'description' => $i->description,
                'image_url' => $i->image_path ? Storage::disk('public')->url($i->image_path) : null,
                'project_url' => $i->project_url,
            ]),
        ];
    }

    private function portfolioForRequest(Request $request): Portfolio
    {
        $intern = $request->user();

        return Portfolio::with('items')->firstOrCreate(
            ['intern_id' => $intern->id],
            [
                'school_id' => $intern->school_id,
                'title' => trim("{$intern->first_name} {$intern->last_name}") ?: $intern->name,
                'is_public' => false,
            ]
        );
    }

    public function portfolio(Request $request): JsonResponse
    {
        return response()->json(['portfolio' => $this->mapPortfolio($this->portfolioForRequest($request))]);
    }

    public function updatePortfolio(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:150',
            'bio' => 'nullable|string|max:2000',
            'is_public' => 'sometimes|boolean',
        ]);

        $portfolio = $this->portfolioForRequest($request);

        $updates = [];
        if (!empty($data['title'])) {
            $updates['title'] = $data['title'];
        }
        if ($request->has('bio')) {
            $updates['bio'] = $data['bio'] ?? null;
        }
        if ($request->has('is_public')) {
            $updates['is_public'] = (bool) $data['is_public'];
        }
        $portfolio->update($updates);

        return response()->json(['success' => true, 'portfolio' => $this->mapPortfolio($portfolio->fresh('items'))]);
    }

    public function storePortfolioItem(Request $request): JsonResponse
    {
        $portfolio = $this->portfolioForRequest($request);

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'project_url' => 'nullable|url|max:255',
            'image' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:3072',
        ]);

        $imagePath = null;
        if ($request->hasFile('image')) {
            $imagePath = $request->file('image')->store("portfolio/{$request->user()->id}", 'public');
        }

        $item = $portfolio->items()->create([
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'project_url' => $data['project_url'] ?? null,
            'image_path' => $imagePath,
        ]);

        return response()->json(['success' => true, 'item' => [
            'id' => $item->id,
            'title' => $item->title,
            'description' => $item->description,
            'image_url' => $item->image_path ? Storage::disk('public')->url($item->image_path) : null,
            'project_url' => $item->project_url,
        ]]);
    }

    public function destroyPortfolioItem(Request $request, int $id): JsonResponse
    {
        $item = PortfolioItem::whereHas('portfolio', fn ($q) => $q->where('intern_id', $request->user()->id))->find($id);
        if (!$item) {
            return response()->json(['success' => false, 'message' => 'Item not found.'], 404);
        }

        if ($item->image_path) {
            Storage::disk('public')->delete($item->image_path);
        }
        $item->delete();

        return response()->json(['success' => true, 'message' => 'Item removed.']);
    }
}
