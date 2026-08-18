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

        if ($status === 'completed' && !$wasCompleted && $this->assigned_by) {
            NotificationService::send(
                audienceRole: 'supervisor',
                type: 'task_completed',
                title: 'Task completed — ready to rate',
                body: "\"{$this->title}\" is done. Rate it to close it out.",
                schoolId: $this->company?->school_id,
                userId: $this->assigned_by,
                link: "/supervisor/tasks/{$this->id}",
            );
        }
    }
}
