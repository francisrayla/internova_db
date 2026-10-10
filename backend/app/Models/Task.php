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

    /** True when at least one subtask is not done yet. A task with no subtasks has nothing unfinished. */
    public function hasUnfinishedSubtasks(): bool
    {
        return $this->subtasks()->where('status', '!=', 'completed')->exists();
    }

    /** The supervisor has graded it. A rated task is closed out: it sits in History and feeds the intern's evaluation. */
    public function isRated(): bool
    {
        return $this->evaluation()->exists();
    }

    /**
     * Why a subtask cannot be added right now, or null when it can. A done task is closed to new
     * subtasks: adding one would leave a finished parent with unfinished work, and (once rated)
     * would change work the supervisor already graded. The caller answers with a 422.
     */
    public function subtaskAddBlock(): ?string
    {
        if ($this->status !== 'completed') {
            return null;
        }

        return $this->isRated()
            ? 'This task has already been rated, so no more subtasks can be added to it.'
            : 'This task is already marked done, so a subtask cannot be added to it. A task can only be done when every subtask is done. Create a new task for the extra work instead.';
    }

    /** Answer when someone tries to move a subtask out of Done while its parent task is done. */
    public const SUBTASK_FROZEN_MESSAGE = 'This task is already marked done, so its subtasks can no longer be moved back. A done task needs all of its subtasks done.';

    /**
     * Done, but the supervisor's grade is still missing, so it stays in the Active list. Only applies when the
     * school's plan includes per-task ratings: without that feature nobody can ever grade it, so a finished
     * task would otherwise be stuck as "waiting" forever.
     */
    public function awaitingRating(bool $ratingsEnabled): bool
    {
        return $ratingsEnabled && $this->status === 'completed' && !$this->evaluation;
    }

    /** History = finished and no longer waiting for a grade (the same rule as awaitingRating(), as SQL). */
    public function scopeInHistory($query, bool $ratingsEnabled)
    {
        return $query->where('status', 'completed')->when($ratingsEnabled, fn ($q) => $q->whereHas('evaluation'));
    }

    /** Everything that is not in History: still open, or done and waiting for a grade. */
    public function scopeNotInHistory($query, bool $ratingsEnabled)
    {
        return $query->where(function ($w) use ($ratingsEnabled) {
            $w->where('status', '!=', 'completed');
            if ($ratingsEnabled) {
                $w->orWhere(fn ($x) => $x->where('status', 'completed')->whereDoesntHave('evaluation'));
            }
        });
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

        // Last line of defence: a parent task can never become done while one of its subtasks is not.
        // Every caller checks first and answers the user with a message; this only keeps the data
        // consistent if a future code path forgets to.
        if ($status === 'completed' && $this->hasUnfinishedSubtasks()) {
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
