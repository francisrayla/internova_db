<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\AccountInvitation;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\EvaluationCriterion;
use App\Models\EvaluationScore;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\Subtask;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\TaskProof;
use App\Models\User;
use App\Services\ActivityLogService;
use App\Services\DeploymentSummaryService;
use App\Services\NotificationService;
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

    // Local dev only — matches the pattern already used in CoordinatorSubscriptionController.
    private const FRONTEND_URL = 'http://localhost:3000';
    private const INVITATION_EXPIRES_IN_DAYS = 7;

    /**
     * Sends a real "set your own password" invitation instead of the
     * coordinator choosing a password on the recipient's behalf — the
     * recipient proves they control the inbox by clicking it (see
     * InvitationController::accept(), which marks email_verified_at there).
     */
    private function sendAccountInvitation(User $user, string $roleLabel, string $contextLabel): void
    {
        $plainToken = Str::random(64);

        $user->update([
            'invitation_token' => hash('sha256', $plainToken),
            'invitation_expires_at' => now()->addDays(self::INVITATION_EXPIRES_IN_DAYS),
        ]);

        $acceptUrl = self::FRONTEND_URL . '/accept-invite/' . $plainToken;

        Mail::to($user->email, $user->name)->send(new AccountInvitation(
            recipientName: trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            roleLabel: $roleLabel,
            contextLabel: $contextLabel,
            acceptUrl: $acceptUrl,
            expiresInDays: (string) self::INVITATION_EXPIRES_IN_DAYS,
        ));
    }

    // ---------------------------------------------------------------
    // Interns
    // ---------------------------------------------------------------

    public function interns(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $deployments = InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('school_id', $schoolId)
            ->orderByDesc('id')
            ->get();

        $profiles = InternProfile::where('school_id', $schoolId)->get()->keyBy('user_id');

        $interns = $deployments->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)));

        return response()->json(['interns' => $interns->values()]);
    }

    // ---------------------------------------------------------------
    // Attendance — coordinators can only view. Logging/approving belongs to
    // the intern's supervisor (see SupervisorMonitoringController) — a
    // coordinator wasn't there to see whether the intern actually showed up.
    // ---------------------------------------------------------------

    public function attendance(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deploymentIds = $this->deploymentIdsForSchool($schoolId);

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
                'clock_out' => $a->clock_out?->format('h:i A'),
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

        $tasks = $query->get()->map(fn (Task $t) => $this->mapTaskRow($t));

        $companies = Company::where('school_id', $schoolId)->orderBy('company_name')->get(['id', 'company_name']);

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

        $documents = $query->get()->map(fn (Document $d) => [
            'id' => $d->id,
            'deployment_id' => $d->deployment_id,
            'intern_name' => trim("{$d->deployment?->intern?->first_name} {$d->deployment?->intern?->last_name}") ?: $d->deployment?->intern?->name,
            'document_type' => $d->document_type,
            'file_name' => $d->file_name,
            'file_url' => Storage::disk('public')->url($d->file_path),
            'status' => $d->status,
            'remarks' => $d->remarks,
            'uploaded_at' => $d->created_at->format('M d, Y'),
        ]);

        return response()->json(['documents' => $documents, 'interns' => $this->internOptionsForSchool($schoolId)]);
    }

    public function storeDocument(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'document_type' => 'required|string|max:100',
            'file' => 'required|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:5120',
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

        $document->update(['status' => $data['status'], 'remarks' => $data['remarks'] ?? null]);
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

        return response()->json(['success' => true, 'message' => 'Criterion added.', 'criterion' => $criterion]);
    }

    public function evaluations(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $deploymentIds = $this->deploymentIdsForSchool($schoolId);

        $query = Evaluation::with(['deployment.intern', 'evaluator', 'scores.criterion'])
            ->whereIn('deployment_id', $deploymentIds)
            ->orderByDesc('evaluation_date');

        if ($internId = $request->query('intern_id')) {
            $query->whereHas('deployment', fn ($q) => $q->where('intern_id', $internId));
        }

        $evaluations = $query->get()->map(fn (Evaluation $e) => $this->mapEvaluation($e));

        return response()->json(['evaluations' => $evaluations, 'interns' => $this->internOptionsForSchool($schoolId)]);
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

    // ---------------------------------------------------------------
    // Companies
    // ---------------------------------------------------------------

    public function companies(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $companies = Company::where('school_id', $schoolId)
            ->withCount(['deployments as active_interns_count' => fn ($q) => $q->where('status', 'active')])
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
                'active_interns_count' => $c->active_interns_count,
            ]);

        return response()->json(['companies' => $companies]);
    }

    public function storeCompany(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'company_name' => 'required|string|max:255',
            'address' => 'nullable|string|max:500',
            'contact_email' => 'nullable|email|max:255',
            'contact_number' => 'nullable|string|max:50',
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

        $data = $request->validate([
            'company_name' => 'sometimes|required|string|max:255',
            'address' => 'nullable|string|max:500',
            'contact_email' => 'nullable|email|max:255',
            'contact_number' => 'nullable|string|max:50',
            'status' => 'sometimes|required|string|in:active,inactive',
        ]);

        $company->update($data);

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
        $company = Company::where('id', $id)->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        $supervisors = SupervisorProfile::with('user')->where('company_id', $company->id)->get()
            ->map(fn (SupervisorProfile $s) => [
                'user_id' => $s->user_id,
                'name' => trim("{$s->user?->first_name} {$s->user?->last_name}") ?: $s->user?->name,
                'email' => $s->user?->email,
                'position' => $s->position,
            ]);

        $profiles = InternProfile::where('school_id', $schoolId)->get()->keyBy('user_id');
        $interns = InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('company_id', $company->id)
            ->orderByDesc('id')
            ->get()
            ->map(fn (InternshipDeployment $d) => DeploymentSummaryService::summarize($d, $profiles->get($d->intern_id)));

        return response()->json([
            'company' => $company,
            'supervisors' => $supervisors->values(),
            'interns' => $interns->values(),
        ]);
    }

    /**
     * Deleting a company would cascade-delete every supervisor profile and
     * deployment (and, through those, attendance/tasks/evaluations/documents)
     * tied to it — blocked outright rather than silently destroying that
     * history. "Mark inactive" is the safe way to retire a company instead.
     */
    public function destroyCompany(Request $request, int $id): JsonResponse
    {
        $schoolId = $request->user()->school_id;
        $company = Company::where('id', $id)->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Company not found.'], 404);
        }

        $supervisorCount = SupervisorProfile::where('company_id', $company->id)->count();
        $deploymentCount = InternshipDeployment::where('company_id', $company->id)->count();

        if ($supervisorCount > 0 || $deploymentCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "Can't delete — this company still has {$supervisorCount} supervisor(s) and {$deploymentCount} intern deployment(s) on file. Remove those first, or mark the company inactive instead.",
            ], 422);
        }

        $company->delete();

        ActivityLogService::record(
            module: 'Companies',
            action: 'Deleted company',
            description: "{$company->company_name} removed — had no supervisors or deployments on file.",
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
        $query = SupervisorProfile::with('user')->where('school_id', $schoolId);

        if ($companyId = $request->query('company_id')) {
            $query->where('company_id', $companyId);
        }

        $supervisors = $query->get()->map(fn (SupervisorProfile $s) => [
            'user_id' => $s->user_id,
            'name' => trim("{$s->user?->first_name} {$s->user?->last_name}") ?: $s->user?->name,
            'company_id' => $s->company_id,
        ]);

        return response()->json(['supervisors' => $supervisors]);
    }

    public function storeSupervisor(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'company_id' => 'required|integer',
            'position' => 'nullable|string|max:150',
        ]);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select a company that belongs to your school.'], 422);
        }

        $supervisorRole = Role::where('name', 'supervisor')->first();
        if (!$supervisorRole) {
            return response()->json(['success' => false, 'message' => 'supervisor role is not configured.'], 500);
        }

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

        $this->sendAccountInvitation($user, 'Supervisor', "at {$company->company_name}");

        ActivityLogService::record(
            module: 'Companies',
            action: 'Invited supervisor',
            description: "{$data['first_name']} {$data['last_name']} invited as a supervisor at {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Invitation sent.']);
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

        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($userId)],
            'position' => 'nullable|string|max:150',
        ]);

        $profile->user->update([
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'name' => "{$data['first_name']} {$data['last_name']}",
            'email' => $data['email'],
        ]);
        $profile->update(['position' => $data['position'] ?? null]);

        return response()->json(['success' => true, 'message' => 'Supervisor updated.']);
    }

    /**
     * Blocked while this supervisor is still assigned to any deployment —
     * deleting them would silently null out that intern's supervisor rather
     * than reassigning it, which should be an explicit choice, not a
     * side-effect of deleting an account.
     */
    public function destroySupervisor(Request $request, int $userId): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $profile = SupervisorProfile::where('user_id', $userId)->where('school_id', $schoolId)->first();
        if (!$profile || !$profile->user) {
            return response()->json(['success' => false, 'message' => 'Supervisor not found.'], 404);
        }

        $assignedCount = InternshipDeployment::where('supervisor_id', $userId)->count();
        if ($assignedCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "Can't delete — this supervisor is still assigned to {$assignedCount} intern deployment(s). Reassign those interns to another supervisor first.",
            ], 422);
        }

        $name = trim("{$profile->user->first_name} {$profile->user->last_name}") ?: $profile->user->name;

        DB::transaction(function () use ($profile) {
            $user = $profile->user;
            $profile->delete();
            $user->delete();
        });

        ActivityLogService::record(
            module: 'Companies',
            action: 'Deleted supervisor',
            description: "{$name} removed as a supervisor.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Supervisor deleted.']);
    }

    public function storeIntern(Request $request): JsonResponse
    {
        $schoolId = $request->user()->school_id;

        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'student_number' => 'nullable|string|max:100',
            'course' => 'nullable|string|max:150',
            'year_level' => 'nullable|string|max:50',
            'company_id' => 'required|integer',
            'supervisor_id' => 'nullable|integer',
            'start_date' => 'required|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
            'required_hours' => 'required|integer|min:1|max:2000',
        ]);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select a company that belongs to your school.'], 422);
        }

        if (!empty($data['supervisor_id'])) {
            $validSupervisor = SupervisorProfile::where('user_id', $data['supervisor_id'])
                ->where('company_id', $company->id)
                ->where('school_id', $schoolId)
                ->exists();
            if (!$validSupervisor) {
                return response()->json(['success' => false, 'message' => 'Select a supervisor that belongs to this company.'], 422);
            }
        }

        $internRole = Role::where('name', 'intern')->first();
        if (!$internRole) {
            return response()->json(['success' => false, 'message' => 'intern role is not configured.'], 500);
        }

        [$user, $deployment] = DB::transaction(function () use ($data, $schoolId, $internRole, $request) {
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
                'student_number' => $data['student_number'] ?? null,
                'course' => $data['course'] ?? null,
                'year_level' => $data['year_level'] ?? null,
                'required_hours' => $data['required_hours'],
            ]);

            $deployment = InternshipDeployment::create([
                'school_id' => $schoolId,
                'intern_id' => $user->id,
                'company_id' => $data['company_id'],
                'supervisor_id' => $data['supervisor_id'] ?? null,
                'coordinator_id' => $request->user()->id,
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'] ?? null,
                'required_hours' => $data['required_hours'],
                'status' => 'active',
            ]);

            return [$user, $deployment];
        });

        $this->sendAccountInvitation($user, 'Intern', "at {$company->company_name}");

        ActivityLogService::record(
            module: 'Interns',
            action: 'Invited intern',
            description: "{$data['first_name']} {$data['last_name']} invited and deployed to {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Invitation sent.', 'deployment_id' => $deployment->id]);
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

        $recordCount = Attendance::where('deployment_id', $deployment->id)->count()
            + Task::whereHas('assignees', fn ($q) => $q->where('deployment_id', $deployment->id))->count()
            + Evaluation::where('deployment_id', $deployment->id)->count()
            + Document::where('deployment_id', $deployment->id)->count();

        if ($recordCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "Can't delete — this intern already has {$recordCount} recorded attendance/task/evaluation/document entr(y/ies). That history can't be removed from here.",
            ], 422);
        }

        $internName = $deployment->intern?->name;

        DB::transaction(function () use ($deployment) {
            $intern = $deployment->intern;
            $deployment->delete();
            InternProfile::where('user_id', $intern->id)->delete();
            $intern->delete();
        });

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

        $data = $request->validate([
            'required_hours' => 'required|integer|min:1|max:2000',
            'start_date' => 'required|date',
            'supervisor_id' => 'nullable|integer',
        ]);

        // Assigning/changing who supervises this intern at their current company —
        // e.g. a supervisor added after the intern was already deployed there.
        // Safe to update in place: already-logged attendance/tasks aren't tied to
        // "who was supervisor at the time," only to the deployment itself.
        if (array_key_exists('supervisor_id', $data) && !empty($data['supervisor_id'])) {
            $validSupervisor = SupervisorProfile::where('user_id', $data['supervisor_id'])
                ->where('company_id', $deployment->company_id)
                ->where('school_id', $schoolId)
                ->exists();
            if (!$validSupervisor) {
                return response()->json(['success' => false, 'message' => 'Select a supervisor that belongs to this intern\'s company.'], 422);
            }
        }

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
     * Moves an intern to a different company. This does NOT edit the current
     * deployment row in place — that would misattribute any attendance/tasks
     * already logged against it to the new company. Instead the current
     * deployment is closed out as "completed" and a fresh deployment is
     * created for the new company, so each placement keeps its own honest
     * history (mirrors a real internship/employment history).
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
            'supervisor_id' => 'nullable|integer',
            'start_date' => 'required|date',
            'required_hours' => 'required|integer|min:1|max:2000',
        ]);

        $company = Company::where('id', $data['company_id'])->where('school_id', $schoolId)->where('status', 'active')->first();
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Select an active company that belongs to your school.'], 422);
        }

        if (!empty($data['supervisor_id'])) {
            $validSupervisor = SupervisorProfile::where('user_id', $data['supervisor_id'])
                ->where('company_id', $company->id)
                ->where('school_id', $schoolId)
                ->exists();
            if (!$validSupervisor) {
                return response()->json(['success' => false, 'message' => 'Select a supervisor that belongs to this company.'], 422);
            }
        }

        $oldCompanyName = $deployment->company?->company_name;
        $internId = $deployment->intern_id;
        $internName = $deployment->intern?->name;

        $newDeployment = DB::transaction(function () use ($deployment, $data, $schoolId, $internId, $request) {
            $deployment->update(['status' => 'completed']);

            return InternshipDeployment::create([
                'school_id' => $schoolId,
                'intern_id' => $internId,
                'company_id' => $data['company_id'],
                'supervisor_id' => $data['supervisor_id'] ?? null,
                'coordinator_id' => $request->user()->id,
                'start_date' => $data['start_date'],
                'required_hours' => $data['required_hours'],
                'status' => 'active',
            ]);
        });

        ActivityLogService::record(
            module: 'Interns',
            action: 'Reassigned intern',
            description: "{$internName} moved from {$oldCompanyName} to {$company->company_name}.",
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Intern reassigned.', 'deployment_id' => $newDeployment->id]);
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
