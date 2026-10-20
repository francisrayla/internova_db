<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Support\LocalTime;
use App\Support\Paging;
use App\Support\TaskListing;
use App\Support\UploadMessages;
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
use App\Jobs\GenerateNarrativeForAttendance;
use App\Services\ActivityLogService;
use App\Services\AttendanceLocationService;
use App\Services\AttendanceSessions;
use App\Services\DeploymentHistoryService;
use App\Services\DeploymentSummaryService;
use App\Services\NarrativeAiService;
use App\Services\PlanFeatures;
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
 * with a selfie + GPS location as the verification evidence) and lands as
 * "approved" immediately — the selfie/location stamp is the verification,
 * so no separate supervisor review step gates it. A supervisor can still
 * flip a record to "rejected" after the fact if something looks wrong (see
 * SupervisorMonitoringController::reviewAttendance).
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
            ->whereDate('activity_date', LocalTime::today())
            ->exists();

        return response()->json([
            'has_deployment' => true,
            ...$summary,
            'evaluations_count' => $evaluationsCount,
            'last_activity_date' => $lastActivityDate ? Carbon::parse($lastActivityDate)->format('M d, Y') : null,
            'has_activity_today' => $hasActivityToday,
            // Earlier placements (empty when the intern was never reassigned).
            'history' => DeploymentHistoryService::segments($deployment),
        ]);
    }

    /**
     * "Your next step": the intern's queue, in priority order (clock in / hours left, then what is left once the
     * hours are done, tasks that are late, things sent back). Computed from the same summary row as the tiles.
     */
    public function dashboard(Request $request): JsonResponse
    {
        $intern = $request->user();
        $deployment = $this->currentDeploymentFor($intern->id);
        if (!$deployment) {
            return response()->json(['has_deployment' => false, 'queue' => []]);
        }

        $summary = DeploymentSummaryService::summarize($deployment, InternProfile::where('user_id', $intern->id)->first());

        return response()->json([
            'has_deployment' => true,
            'is_finished' => $summary['is_finished'],
            'queue' => \App\Services\DashboardQueueService::intern($intern, $deployment, $summary),
        ]);
    }

    /** The intern's own "next steps" list for the bell (their own deployment only). */
    public function attentionQueue(\App\Models\User $intern): array
    {
        $deployment = $this->currentDeploymentFor($intern->id);
        if (!$deployment) {
            return [];
        }
        $summary = DeploymentSummaryService::summarize($deployment, InternProfile::where('user_id', $intern->id)->first());

        return \App\Services\DashboardQueueService::intern($intern, $deployment, $summary);
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

        // ?view=active (open work, whole) or ?view=history (finished and graded, paged); no view = every task.
        if ($listed = TaskListing::respond($request, $query, $this->ratingsEnabled(), fn (Task $t) => $this->mapTaskRow($t, $internId))) {
            return response()->json($listed);
        }

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t, $internId));

        return response()->json(['tasks' => $tasks]);
    }

    private ?bool $ratingsEnabled = null;

    /** Does this school's plan include per-task ratings? (decides whether a done task waits for a grade) */
    private function ratingsEnabled(): bool
    {
        return $this->ratingsEnabled ??= PlanFeatures::has(request()->user()?->school, PlanFeatures::TASK_RATINGS);
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
            // Who the leader is, so a member can see who to ask (TaskDetailView shows "Leader: name").
            'leader_id' => $assignees->count() > 1 ? $t->leader_id : null,
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
            'created_at' => $c->created_at->local()->format('M d, Y g:i A'),
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
            'created_at' => $p->created_at->local()->format('M d, Y g:i A'),
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
                'mime_type' => $file->getMimeType(),
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
        // Once the supervisor has graded it the task is closed out; moving it back would undo a graded task.
        if ($task->isRated()) {
            return response()->json(['success' => false, 'message' => 'This task has already been rated by the supervisor, so its status can no longer be changed.'], 422);
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

        // Proof attachments are a Premium feature — a Basic-plan school can
        // still mark a task done, just without being required to upload
        // evidence first.
        $requiresProof = PlanFeatures::has($request->user()->school, PlanFeatures::ATTACHMENTS);
        if ($requiresProof) {
            $request->validate([
                'proofs' => 'required|array|min:1',
                'proofs.*' => 'file|mimes:jpg,jpeg,png,pdf,doc,docx,xls,xlsx,ppt,pptx|max:15360',
            ], UploadMessages::for('proofs.*', 'JPG, PNG, PDF, Word, Excel or PowerPoint', 15, 'proof file') + ['proofs.required' => 'Attach at least one proof file.']);
            $this->storeProofFiles($request, $task->id, null, $internId);
        }

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
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::SUBTASKS)) {
            return response()->json(['success' => false, 'message' => 'Subtasks aren\'t included in your school\'s current plan.'], 403);
        }

        $internId = $request->user()->id;
        $task = $this->taskForIntern($taskId, $internId);
        if (!$task) {
            return response()->json(['success' => false, 'message' => 'Task not found.'], 404);
        }

        if (!$this->canManageTaskStatus($task, $internId)) {
            return response()->json(['success' => false, 'message' => 'Only the task leader can add subtasks for this group.'], 403);
        }

        if ($block = $task->subtaskAddBlock()) {
            return response()->json(['success' => false, 'message' => $block], 422);
        }

        // Same rule as the supervisor's subtasks: a due date is today (Manila) or later, never in the past.
        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'due_date' => 'nullable|date|after_or_equal:' . LocalTime::today(),
            'assignee_ids' => 'nullable|array',
            'assignee_ids.*' => 'integer',
        ], ['due_date.after_or_equal' => 'The due date cannot be in the past. Choose today or a later date.']);

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
        // Done is final for a subtask.
        if ($subtask->status === 'completed') {
            return response()->json(['success' => false, 'message' => Task::SUBTASK_DONE_MESSAGE], 422);
        }
        // A done task keeps all its subtasks done; sliding one back would leave a finished parent with open work.
        if ($subtask->task->status === 'completed') {
            return response()->json(['success' => false, 'message' => Task::SUBTASK_FROZEN_MESSAGE], 422);
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

        if (PlanFeatures::has($request->user()->school, PlanFeatures::ATTACHMENTS)) {
            $request->validate([
                'proofs' => 'required|array|min:1',
                'proofs.*' => 'file|mimes:jpg,jpeg,png,pdf,doc,docx,xls,xlsx,ppt,pptx|max:15360',
            ], UploadMessages::for('proofs.*', 'JPG, PNG, PDF, Word, Excel or PowerPoint', 15, 'proof file') + ['proofs.required' => 'Attach at least one proof file.']);
            $this->storeProofFiles($request, null, $subtask->id, $internId);
        }

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
            'session' => $a->session ?: Attendance::FULL,
            'session_label' => match ($a->session) { Attendance::AM => 'Morning', Attendance::PM => 'Afternoon', default => null },
            'clock_in' => $a->clock_in?->local()?->format('h:i A'),
            'clock_in_selfie_url' => $a->clock_in_selfie_path ? Storage::disk('public')->url($a->clock_in_selfie_path) : null,
            'clock_in_location' => $a->clock_in_latitude !== null ? ['lat' => $a->clock_in_latitude, 'lng' => $a->clock_in_longitude] : null,
            'clock_in_is_offline' => (bool) $a->clock_in_is_offline,
            'clock_out' => $a->clock_out?->local()?->format('h:i A'),
            'clock_out_selfie_url' => $a->clock_out_selfie_path ? Storage::disk('public')->url($a->clock_out_selfie_path) : null,
            'clock_out_location' => $a->clock_out_latitude !== null ? ['lat' => $a->clock_out_latitude, 'lng' => $a->clock_out_longitude] : null,
            'clock_out_is_offline' => (bool) $a->clock_out_is_offline,
            'clock_in_distance_m' => $a->clock_in_distance_m,
            'clock_out_distance_m' => $a->clock_out_distance_m,
            'location_flags' => array_values(array_unique([...($a->clock_in_location_flags ?? []), ...($a->clock_out_location_flags ?? [])])),
            'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60, 1) : null,
            'auto_clocked_out' => (bool) $a->auto_clocked_out,
            'edited' => $a->edited_at !== null,
            'status' => $a->status,
        ];
    }

    public function attendance(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $records = Attendance::whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('attendance_date')
            ->orderByDesc('id')
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
        // day_ends_at lets the app tell, offline, when a cached copy of this
        // response belongs to a day that's already over — without it, a
        // "today's attendance complete" cached yesterday would block clock-in.
        $dayEndsAt = LocalTime::now()->endOfDay()->toIso8601String();

        if (!$deployment) {
            return response()->json(['record' => null, 'next_action' => null, 'day_ends_at' => $dayEndsAt]);
        }

        $rows = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', LocalTime::today())
            ->orderBy('id')
            ->get();
        $companyMode = AttendanceSessions::modeFor($deployment->company);
        $next = AttendanceSessions::next($companyMode, $rows);
        $record = $rows->last();

        return response()->json([
            'record' => $record ? $this->mapAttendance($record) : null,
            'rows' => $rows->map(fn (Attendance $a) => $this->mapAttendance($a))->values(),
            'next_action' => $next['action'] ?? null,
            // Which punch it is (full day, morning or afternoon) and what to call it on screen.
            'session' => $next['session'] ?? null,
            'label' => $next['label'] ?? null,
            'mode' => AttendanceSessions::dayMode($companyMode, $rows),
            'steps' => AttendanceSessions::steps($companyMode, $rows),
            'day_ends_at' => $dayEndsAt,
            // Why clocking in is closed (not started yet, finished, inactive), or null when it is open.
            'clock_block' => $deployment->attendanceBlock(LocalTime::today()),
        ]);
    }

    private function selfieAndLocation(Request $request): array
    {
        $data = $request->validate([
            'selfie' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            // How precise the phone said the fix was (metres) and how old it was when the photo was taken (seconds).
            'accuracy' => 'nullable|numeric|min:0|max:100000',
            'fix_age' => 'nullable|numeric|min:0|max:86400',
            // The page found the browser's location functions replaced by script (a spoofing tool).
            'geo_tampered' => 'nullable|boolean',
        ]);

        return $data;
    }

    /**
     * Every normal clock-in/out is timestamped by the server (`now()`) — a
     * phone's own clock is trivial to change. The exception is an entry
     * captured while offline (lib/offlineQueue.js), which arrives later and
     * has to say when it happened. Its time is never taken at face value:
     *
     * - device_time + skew: the phone also sends its clock at sync time
     *   (device_now), so the server measures how far off that clock is and
     *   corrects the capture time by the same amount. Changing the phone's
     *   date doesn't help — the correction undoes it.
     * - anchored_time: when the app had synced with the server earlier in the
     *   same session, it timed the capture with a server-anchored timer
     *   (lib/trustedClock.js) that ignores the device clock entirely.
     *
     * When both exist and disagree by more than a few minutes, the one less
     * favourable to the intern wins (the later clock-in, the earlier
     * clock-out). The result must fall within the last 48 hours, and the
     * entry stays flagged offline (`is_offline` + `synced_at`).
     */
    private function resolveClockTime(Request $request, string $mode = 'clock_in'): array
    {
        $isOffline = $request->boolean('is_offline');

        if (!$isOffline) {
            return [now(), false, null];
        }

        $data = $request->validate([
            'device_time' => 'required|date',
            'device_now' => 'nullable|date',
            'anchored_time' => 'nullable|date',
        ]);

        $tz = config('app.timezone');
        $deviceTime = Carbon::parse($data['device_time'])->setTimezone($tz);

        // How far the phone's clock is from the server's, measured now.
        $skewSeconds = !empty($data['device_now'])
            ? now()->getTimestamp() - Carbon::parse($data['device_now'])->getTimestamp()
            : 0;
        $corrected = $deviceTime->copy()->addSeconds($skewSeconds);

        $resolved = $corrected;
        if (!empty($data['anchored_time'])) {
            $anchored = Carbon::parse($data['anchored_time'])->setTimezone($tz);
            if (abs($anchored->getTimestamp() - $corrected->getTimestamp()) > 5 * 60) {
                $resolved = $mode === 'clock_in' ? $anchored->max($corrected) : $anchored->min($corrected);
            }
        }

        if ($resolved->lt(now()->subHours(48)) || $resolved->gt(now()->addMinutes(5))) {
            abort(response()->json([
                'success' => false,
                'message' => 'That offline entry\'s time doesn\'t line up with the server — it was not saved. Please clock in again while online.',
            ], 422));
        }

        return [$resolved, true, now()];
    }

    public function clockIn(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to clock in.'], 422);
        }

        // A double tap (or a retry racing the first request) must not create two rows for the same punch: the
        // check "already clocked in?" and the insert run one at a time per deployment.
        return \Illuminate\Support\Facades\DB::transaction(function () use ($request, $deployment) {
            InternshipDeployment::whereKey($deployment->id)->lockForUpdate()->first();

            return $this->recordClockIn($request, $deployment);
        });
    }

    private function recordClockIn(Request $request, InternshipDeployment $deployment): JsonResponse
    {
        [$clockTime, $isOffline, $syncedAt] = $this->resolveClockTime($request, 'clock_in');
        // Bucketed by the day it actually happened on, not the day it
        // happened to sync on — an offline clock-in at 11pm that only
        // reaches the server the next morning still belongs to that first day.
        $today = LocalTime::date($clockTime);

        // Not before the first day of the internship, and not once the required hours are rendered.
        if ($block = $deployment->attendanceBlock($today)) {
            return response()->json(['success' => false, 'message' => $block['message'], 'code' => $block['code']], 422);
        }

        $rows = Attendance::where('deployment_id', $deployment->id)
            ->whereDate('attendance_date', $today)
            ->orderBy('id')
            ->get();

        // Which part of the day this is. An offline entry says so itself (the
        // phone knew what it was waiting to send); otherwise the server works it out.
        $request->validate(['session' => 'nullable|in:full,am,pm']);
        $companyMode = AttendanceSessions::modeFor($deployment->company);
        $next = AttendanceSessions::next($companyMode, $rows);
        $session = $request->input('session') ?: (($next['action'] ?? null) === 'clock_in' ? $next['session'] : null);
        if (!$session) {
            return response()->json(['success' => false, 'message' => $next ? 'Clock out first before you clock in again.' : 'You already clocked in today.'], 422);
        }

        $dayMode = AttendanceSessions::dayMode($companyMode, $rows);
        if (($session === Attendance::FULL) !== ($dayMode === AttendanceSessions::SINGLE) && $rows->isNotEmpty()) {
            return response()->json(['success' => false, 'message' => 'Today is already being recorded in a different format.'], 422);
        }
        $existing = $rows->firstWhere('session', $session);
        if ($existing && $existing->clock_in) {
            return response()->json(['success' => false, 'message' => $session === Attendance::FULL ? 'You already clocked in today.' : 'You already did this for ' . strtolower($session === Attendance::AM ? 'the morning' : 'the afternoon') . '.'], 422);
        }
        if ($session === Attendance::PM && $rows->contains(fn ($r) => $r->session === Attendance::AM && $r->clock_in && !$r->clock_out)) {
            return response()->json(['success' => false, 'message' => 'Time out of your morning first.'], 422);
        }

        $data = $this->selfieAndLocation($request);
        $check = AttendanceLocationService::assess(
            $deployment->company, (float) $data['latitude'], (float) $data['longitude'],
            isset($data['accuracy']) ? (float) $data['accuracy'] : null, isset($data['fix_age']) ? (float) $data['fix_age'] : null,
            $isOffline, $deployment->id, 'clock_in', mayBlock: true, tampered: $request->boolean('geo_tampered'), at: $clockTime,
        );
        if ($check['block']) {
            return response()->json(['success' => false, 'message' => $check['block']['message'], 'code' => $check['block']['code']], 422);
        }
        $selfiePath = $request->file('selfie')->store("attendance-selfies/deployment-{$deployment->id}", 'public');

        $attendance = $existing ?? new Attendance(['deployment_id' => $deployment->id, 'attendance_date' => $today, 'session' => $session]);
        $attendance->fill([
            'clock_in' => $clockTime,
            'clock_in_selfie_path' => $selfiePath,
            'clock_in_latitude' => $data['latitude'],
            'clock_in_longitude' => $data['longitude'],
            'clock_in_is_offline' => $isOffline,
            'clock_in_synced_at' => $syncedAt,
            'clock_in_distance_m' => $check['distance_m'],
            'clock_in_accuracy_m' => $check['accuracy_m'],
            'clock_in_location_flags' => $check['flags'] ?: null,
            // An unusual hour (by the resolved clock time, so an offline entry counts when it really happened).
            'clock_in_odd_hours' => Attendance::isOddHour($clockTime),
            'status' => 'approved',
        ]);
        $attendance->save();

        if ($attendance->clock_in_odd_hours) {
            // The attendance is already saved: a failed notification must never undo or fail the clock-in.
            rescue(fn () => $attendance->notifyOddHoursClockIn());
        }

        $what = $session === Attendance::FULL ? 'clocked in' : 'recorded ' . strtolower(AttendanceSessions::label($session, 'clock_in'));

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Clocked in',
            description: "{$request->user()->name} {$what} on {$attendance->attendance_date->format('M d, Y')}.",
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

        [$clockTime, $isOffline, $syncedAt] = $this->resolveClockTime($request, 'clock_out');
        // Clocking out always closes whichever day's record is still open —
        // an offline clock-out syncing after midnight still belongs to the
        // shift it ended, not to today.
        $request->validate(['session' => 'nullable|in:full,am,pm']);
        $open = Attendance::where('deployment_id', $deployment->id)
            ->whereNotNull('clock_in')
            ->whereNull('clock_out');
        if ($request->filled('session')) {
            $open->where('session', $request->input('session'));
        }
        $attendance = $open->orderByDesc('attendance_date')->orderByDesc('id')->first();
        if (!$attendance) {
            return response()->json(['success' => false, 'message' => 'Clock in first.'], 422);
        }

        $data = $this->selfieAndLocation($request);
        // A time-out is never refused over its location (that would leave the shift open); it is flagged for review.
        $check = AttendanceLocationService::assess(
            $deployment->company, (float) $data['latitude'], (float) $data['longitude'],
            isset($data['accuracy']) ? (float) $data['accuracy'] : null, isset($data['fix_age']) ? (float) $data['fix_age'] : null,
            $isOffline, $deployment->id, 'clock_out', mayBlock: false, tampered: $request->boolean('geo_tampered'), at: $clockTime,
        );
        $selfiePath = $request->file('selfie')->store("attendance-selfies/deployment-{$deployment->id}", 'public');

        $attendance->update([
            'clock_out' => $clockTime,
            'clock_out_selfie_path' => $selfiePath,
            'clock_out_latitude' => $data['latitude'],
            'clock_out_longitude' => $data['longitude'],
            'clock_out_is_offline' => $isOffline,
            'clock_out_synced_at' => $syncedAt,
            'clock_out_distance_m' => $check['distance_m'],
            'clock_out_accuracy_m' => $check['accuracy_m'],
            'clock_out_location_flags' => $check['flags'] ?: null,
            'status' => 'approved',
        ]);
        // A new red location flag on the time-out is news even if the supervisor already checked the time-in.
        if (array_intersect($check['flags'], Attendance::RED_LOCATION_FLAGS) && $attendance->red_flag_checked_at) {
            $attendance->update(['red_flag_checked_by' => null, 'red_flag_checked_at' => null]);
        }

        $what = $attendance->session === Attendance::FULL ? 'clocked out' : 'recorded ' . strtolower(AttendanceSessions::label($attendance->session, 'clock_out'));

        ActivityLogService::record(
            module: 'Attendance',
            action: 'Clocked out',
            description: "{$request->user()->name} {$what} on {$attendance->attendance_date->format('M d, Y')}.",
            schoolId: $deployment->school_id,
            request: $request
        );

        // The morning half of a split day is not the end of the day; the daily
        // summary is written once the afternoon (or a full day) is closed.
        if ($attendance->session !== Attendance::AM) {
            GenerateNarrativeForAttendance::dispatch($attendance->id);
        }

        return response()->json(['success' => true, 'message' => 'Clocked out.', 'record' => $this->mapAttendance($attendance)]);
    }

    private function mapActivity(DailyActivity $a): array
    {
        return [
            'id' => $a->id,
            'activity_date' => $a->activity_date?->format('M d, Y'),
            'activity_date_raw' => $a->activity_date?->toDateString(),
            'title' => $a->title,
            'description' => $a->description,
            'photo_url' => $a->photo_path ? Storage::disk('public')->url($a->photo_path) : null,
            'status' => $a->status,
            'is_auto_generated' => $a->is_auto_generated,
            'editable' => in_array($a->status, DailyActivity::EDITABLE, true),
            'in_report' => in_array($a->status, DailyActivity::IN_REPORT, true),
            'review_remarks' => $a->review_remarks,
            'source_title' => $a->sourceSubtask?->title ?? $a->sourceTask?->title,
        ];
    }

    /**
     * Catches up any past attended date that never got a narrative — covers
     * both gaps left before this feature existed and the rare case where a
     * clock-out's own dispatch (see clockOut()) never ran. Dispatched, not
     * generated inline, since each gap may call the Gemini API. "Today" is
     * excluded: that day's own clock-out already handles it, and the day
     * isn't over yet if the intern hasn't clocked out.
     */
    private function backfillMissingNarratives(array $deploymentIds): void
    {
        $loggedDates = DailyActivity::whereIn('deployment_id', $deploymentIds)
            ->get(['deployment_id', 'activity_date'])
            ->map(fn (DailyActivity $a) => "{$a->deployment_id}:{$a->activity_date->toDateString()}")
            ->all();

        Attendance::whereIn('deployment_id', $deploymentIds)
            ->whereNotNull('clock_out')
            ->where('attendance_date', '<', LocalTime::today())
            ->get(['id', 'deployment_id', 'attendance_date'])
            ->each(function (Attendance $a) use ($loggedDates) {
                $key = "{$a->deployment_id}:{$a->attendance_date->toDateString()}";
                if (!in_array($key, $loggedDates, true)) {
                    GenerateNarrativeForAttendance::dispatch($a->id);
                }
            });
    }

    /**
     * The intern's own daily narrative log — one entry per accomplishment
     * they choose to record, most recent first, plus any day they attended
     * but never wrote one themselves — those are backfilled automatically
     * (see backfillMissingNarratives()) and marked is_auto_generated so the
     * UI can flag them as editable drafts.
     */
    public function activities(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        // Missing daily summaries are filled in once per visit (the first page), not again for every "Load more".
        if ((int) $request->query('page', 1) <= 1) {
            $this->backfillMissingNarratives($deploymentIds);
        }

        $page = DailyActivity::whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('activity_date')
            ->orderByDesc('id')
            ->paginate(Paging::perPage($request, 20, 50));

        return response()->json([
            'activities' => collect($page->items())->map(fn (DailyActivity $a) => $this->mapActivity($a)),
            // First day an entry can be dated (the form's date picker minimum).
            'starts_on' => $this->currentDeploymentFor($internId)?->start_date?->toDateString(),
            ...Paging::meta($page),
        ]);
    }

    /**
     * Tasks/subtasks this intern finished today, not yet turned into a
     * narrative entry — surfaced in Activities as a one-click starting point
     * so the intern isn't retyping what they just logged as done in Tasks.
     * Naturally stops suggesting a completed-today item the moment it's
     * used (see storeActivity's source_task_id/source_subtask_id) or once
     * the day passes, without needing a separate "dismiss" action.
     */
    public function activitySuggestions(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $today = LocalTime::today();

        $usedTaskIds = DailyActivity::whereNotNull('source_task_id')->pluck('source_task_id');
        $usedSubtaskIds = DailyActivity::whereNotNull('source_subtask_id')->pluck('source_subtask_id');

        $tasks = Task::whereHas('assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->where(fn ($q) => LocalTime::whereLocalDate($q, 'completed_at', $today))
            ->whereNotIn('id', $usedTaskIds)
            ->get(['id', 'title', 'description']);

        $subtasks = Subtask::whereHas('task.assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->where(fn ($q) => LocalTime::whereLocalDate($q, 'completed_at', $today))
            ->whereNotIn('id', $usedSubtaskIds)
            ->with('task:id,title')
            ->get(['id', 'task_id', 'title', 'description']);

        $suggestions = $tasks->map(fn (Task $t) => [
            'type' => 'task',
            'id' => $t->id,
            'title' => $t->title,
            'description' => $t->description,
            'context' => null,
        ])->concat($subtasks->map(fn (Subtask $s) => [
            'type' => 'subtask',
            'id' => $s->id,
            'title' => $s->title,
            'description' => $s->description,
            'context' => $s->task?->title,
        ]));

        return response()->json(['suggestions' => $suggestions->values()]);
    }

    /**
     * A suggestion, not a save — the intern reviews the AI's rewrite and
     * decides whether to use it before anything is persisted. Grammar/tone
     * only; it's told explicitly not to invent facts beyond what's written.
     */
    public function polishNarrative(Request $request): JsonResponse
    {
        if (!PlanFeatures::has($request->user()->school, PlanFeatures::AI_FEATURES)) {
            return response()->json(['success' => false, 'message' => 'AI-assisted writing isn\'t included in your school\'s current plan.'], 403);
        }

        $data = $request->validate(['text' => 'required|string|max:4000']);

        if (!NarrativeAiService::isConfigured()) {
            return response()->json(['success' => false, 'message' => 'AI polishing isn\'t set up yet — you can still save your narrative as written.'], 503);
        }

        $polished = NarrativeAiService::polish($data['text'], $request->user()->school_id, $request->user()->id);
        if (!$polished) {
            return response()->json(['success' => false, 'message' => 'Could not reach the AI assistant right now — you can still save your narrative as written.'], 503);
        }

        return response()->json(['success' => true, 'polished' => $polished]);
    }

    public function storeActivity(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = $this->currentDeploymentFor($internId);
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need an active deployment to log activities.'], 422);
        }

        $data = $request->validate([
            // A narrative is about something that already happened: today (Manila) or earlier, never a future day.
            'activity_date' => ['nullable', 'date', 'before_or_equal:' . LocalTime::today()],
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:4000',
            'photo' => 'nullable|image|mimes:jpg,jpeg,png,webp,gif|max:10240',
            'source_task_id' => 'nullable|integer',
            'source_subtask_id' => 'nullable|integer',
        ], UploadMessages::for('photo', 'JPG, PNG, WEBP or GIF', 10, 'photo'));

        // Nor can it describe a day before the internship started.
        if (!$deployment->hasStartedOn($data['activity_date'] ?? null)) {
            $message = "The activity date cannot be before your internship started on {$deployment->start_date->format('F j, Y')}.";

            return response()->json(['success' => false, 'message' => $message, 'errors' => ['activity_date' => [$message]]], 422);
        }

        // Only accepted if it genuinely belongs to this intern — a stray id
        // from the client never gets to attach itself to someone else's task.
        $sourceTaskId = null;
        if (!empty($data['source_task_id']) && $this->taskForIntern((int) $data['source_task_id'], $internId)) {
            $sourceTaskId = (int) $data['source_task_id'];
        }
        $sourceSubtaskId = null;
        if (!empty($data['source_subtask_id'])) {
            $subtask = Subtask::whereHas('task.assignees', fn ($q) => $q->where('user_id', $internId))->find($data['source_subtask_id']);
            if ($subtask) {
                $sourceSubtaskId = $subtask->id;
            }
        }

        $photoPath = null;
        if ($request->hasFile('photo')) {
            $photoPath = $request->file('photo')->store("activity-photos/deployment-{$deployment->id}", 'public');
        }

        $activity = DailyActivity::create([
            'deployment_id' => $deployment->id,
            'source_task_id' => $sourceTaskId,
            'source_subtask_id' => $sourceSubtaskId,
            'activity_date' => $data['activity_date'] ?? LocalTime::today(),
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'photo_path' => $photoPath,
            'status' => DailyActivity::PENDING,
        ]);

        return response()->json(['success' => true, 'activity' => $this->mapActivity($activity)]);
    }

    /**
     * Lets the intern amend their own entry — most importantly, add their
     * own context to an auto-generated narrative (see
     * GenerateNarrativeForAttendance). Only while it's still "pending" or an
     * untouched "recorded" summary: once a supervisor has reviewed it, the
     * record stands as what was actually reviewed, and a correction from
     * there should go through the supervisor rather than silently rewriting
     * history underneath them.
     *
     * Editing a recorded summary makes it the intern's own words, so it
     * loses its auto-generated mark and goes to the supervisor for review.
     */
    public function updateActivity(Request $request, int $id): JsonResponse
    {
        $internId = $request->user()->id;
        $deploymentIds = $this->deploymentIdsForIntern($internId);

        $activity = DailyActivity::whereIn('deployment_id', $deploymentIds)->find($id);
        if (!$activity) {
            return response()->json(['success' => false, 'message' => 'Entry not found.'], 404);
        }
        if (!in_array($activity->status, DailyActivity::EDITABLE, true)) {
            return response()->json(['success' => false, 'message' => 'This entry has already been reviewed and can no longer be edited.'], 422);
        }

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:4000',
        ]);

        $changed = $data['title'] !== $activity->title || ($data['description'] ?? null) !== $activity->description;

        $activity->update([
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
        ] + ($changed && $activity->status === DailyActivity::RECORDED
            ? ['status' => DailyActivity::PENDING, 'is_auto_generated' => false]
            : []));

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
                'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
                'overall_score' => $e->overall_score,
                'remarks' => $e->remarks,
                'category_comments' => $e->category_comments ?? [],
                'edited_at' => $e->edited_at?->local()?->format('M d, Y'),
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
            'uploaded_at' => $d->created_at->local()->format('M d, Y'),
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
            'file' => 'required|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:10240',
        ], UploadMessages::for('file', 'JPG, PNG, PDF, DOC or DOCX', 10));

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

    private function portfolioForRequest(Request $request): Portfolio
    {
        $intern = $request->user();

        return Portfolio::with('items')->firstOrCreate(
            ['intern_id' => $intern->id],
            [
                'school_id' => $intern->school_id,
                'title' => trim("{$intern->first_name} {$intern->last_name}") ?: $intern->name,
            ]
        );
    }

    public function portfolio(Request $request): JsonResponse
    {
        return response()->json(['portfolio' => $this->portfolioForRequest($request)->present()]);
    }

    public function updatePortfolio(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:150',
            'bio' => 'nullable|string|max:2000',
            // Narrative report sections the intern writes themselves.
            'report_texts' => 'sometimes|array',
            'report_texts.acknowledgement' => 'nullable|string|max:5000',
            'report_texts.personal_observation' => 'nullable|string|max:5000',
            'report_texts.suggestion' => 'nullable|string|max:5000',
        ]);

        $portfolio = $this->portfolioForRequest($request);

        $updates = [];
        if (!empty($data['title'])) {
            $updates['title'] = $data['title'];
        }
        if ($request->has('bio')) {
            $updates['bio'] = $data['bio'] ?? null;
        }
        if ($request->has('report_texts')) {
            $texts = $portfolio->report_texts ?? [];
            foreach (['acknowledgement', 'personal_observation', 'suggestion'] as $key) {
                if (array_key_exists($key, $data['report_texts'] ?? [])) {
                    $texts[$key] = $data['report_texts'][$key];
                }
            }
            $updates['report_texts'] = $texts;
        }
        $portfolio->update($updates);

        return response()->json(['success' => true, 'portfolio' => $portfolio->fresh('items')->present()]);
    }

    public function storePortfolioItem(Request $request): JsonResponse
    {
        $portfolio = $this->portfolioForRequest($request);

        $data = $request->validate([
            'title' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'project_url' => 'nullable|url|starts_with:http://,https://|max:255',
            'image' => 'nullable|image|mimes:jpg,jpeg,png,webp,gif|max:10240',
        ], UploadMessages::for('image', 'JPG, PNG, WEBP or GIF', 10, 'image'));

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
