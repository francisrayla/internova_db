<?php

namespace App\Models;

use App\Services\NotificationService;
use Illuminate\Database\Eloquent\Model;

class Task extends Model
{
    protected $fillable = ['company_id', 'assigned_by', 'leader_id', 'title', 'description', 'priority', 'status', 'due_date', 'completed_at'];

    protected $casts = [
        'due_date' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    /** Tasks assigned to interns at the supervisor's company (any supervisor there). */
    public function scopeVisibleToSupervisor($query, User $user)
    {
        return $query->whereHas('assignees', fn ($q) => $q->whereIn('deployment_id', InternshipDeployment::visibleToSupervisor($user)->select('id')));
    }

    public function assignedBy()
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    public function leader()
    {
        return $this->belongsTo(User::class, 'leader_id');
    }

    public function assignees()
    {
        return $this->hasMany(TaskAssignee::class);
    }

    public function subtasks()
    {
        return $this->hasMany(Subtask::class);
    }

    public function comments()
    {
        return $this->hasMany(TaskComment::class)->whereNull('subtask_id')->orderBy('created_at');
    }

    public function evaluation()
    {
        return $this->hasOne(TaskEvaluation::class);
    }

    public function proofs()
    {
        return $this->hasMany(TaskProof::class)->orderBy('created_at');
    }

    /**
     * Who a new subtask goes to. A subtask always has an owner: a solo task gives it to its one
     * intern, a group task needs at least one chosen member, every member must be on the task and
     * must have set up their account. Returns [user ids, null] or [[], error payload].
     */
    public function resolveSubtaskAssignees(array $requestedIds): array
    {
        $this->loadMissing('assignees');
        if (empty($requestedIds) && $this->assignees->count() === 1) {
            $requestedIds = [$this->assignees->first()->user_id];
        }
        if (empty($requestedIds)) {
            return [collect(), ['message' => 'Choose who this subtask is for. A subtask needs at least one member.', 'errors' => ['assignee_ids' => ['Choose at least one member.']]]];
        }
        $validIds = $this->assignees->pluck('user_id')->intersect($requestedIds)->values();
        if ($validIds->count() !== count(array_unique($requestedIds))) {
            return [collect(), ['message' => 'One or more selected interns are not assigned to this task.']];
        }
        if (User::whereIn('id', $validIds)->where('status', 'pending_activation')->exists()) {
            return [collect(), ['message' => 'A member who has not set up their account yet cannot be given a subtask.']];
        }

        return [$validIds, null];
    }

    /**
     * Once a task has subtasks, its own status tracks how far they've
     * gotten — but only up through "in_progress". Every subtask being done
     * does NOT auto-complete the parent: the task leader still has to
     * explicitly mark the whole task complete (with its own proof, see
     * InternMonitoringController::completeTask) before it's ready for the
     * supervisor to rate — that deliberate final step is the whole point,
     * so it can't be skipped just because the last subtask got dragged to
     * Done. A task with zero subtasks keeps the old direct-status behavior
     * as a fallback for simple one-liner work.
     */
    public function recalculateStatusFromSubtasks(): void
    {
        // Once the leader has explicitly finished the task, subtask edits
        // (e.g. reverting one) shouldn't silently reopen or downgrade it.
        if ($this->status === 'completed') {
            return;
        }

        $statuses = $this->subtasks()->pluck('status');
        if ($statuses->isEmpty()) {
            return;
        }

        $status = $statuses->contains(fn ($s) => $s !== 'pending') ? 'in_progress' : 'pending';

        $this->setStatus($status);
    }

    /**
     * Central place any "this task's status just changed" path goes
     * through — used by both the subtask-driven recalculation above and the
     * zero-subtask direct-status fallback (see InternMonitoringController),
     * so the supervisor is notified exactly once, right when a task first
     * becomes completed, regardless of which path got it there.
     */
    public function setStatus(string $status): void
    {
        if ($status === $this->status) {
            return;
        }

        $wasCompleted = $this->status === 'completed';

        $this->update([
            'status' => $status,
            'completed_at' => $status === 'completed' ? now() : null,
        ]);

        if ($status === 'completed' && !$wasCompleted) {
            // Every active supervisor of the task's company can rate it, so all of
            // them are told (one row each). Falls back to the creator.
            $companyIds = InternshipDeployment::whereIn('id', $this->assignees()->pluck('deployment_id'))->pluck('company_id')->push($this->company_id)->filter()->unique();
            $ids = SupervisorProfile::whereIn('company_id', $companyIds)
                ->whereHas('user', fn ($q) => $q->where('status', 'active'))
                ->pluck('user_id')->unique();
            if ($ids->isEmpty() && $this->assigned_by) {
                $ids = collect([$this->assigned_by]);
            }
            foreach ($ids as $uid) {
                NotificationService::send(
                    audienceRole: 'supervisor',
                    type: 'task_completed',
                    title: 'Task completed — ready to rate',
                    body: "\"{$this->title}\" is done. Rate it to close it out.",
                    schoolId: $this->company?->school_id,
                    userId: $uid,
                    link: "/supervisor/tasks/{$this->id}",
                );
            }
        }
    }
}
