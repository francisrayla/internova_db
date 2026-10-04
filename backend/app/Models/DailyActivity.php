<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyActivity extends Model
{
    /**
     * Status lifecycle:
     * - pending: written (or edited) by the intern, waiting for the supervisor.
     * - approved / rejected: the supervisor's decision — final.
     * - recorded: a summary the system drafted from that day's attendance and
     *   completed tasks. It's already backed by the attendance record, so it
     *   needs no sign-off; if the intern edits it, it becomes theirs and goes
     *   to "pending" like any other entry.
     */
    public const PENDING = 'pending';
    public const APPROVED = 'approved';
    public const REJECTED = 'rejected';
    public const RECORDED = 'recorded';

    /** Statuses that make it into the intern's narrative report. */
    public const IN_REPORT = [self::APPROVED, self::RECORDED];

    /** Statuses the intern may still edit. */
    public const EDITABLE = [self::PENDING, self::RECORDED];

    protected $fillable = ['deployment_id', 'source_task_id', 'source_subtask_id', 'activity_date', 'title', 'description', 'photo_path', 'status', 'is_auto_generated', 'reviewed_by', 'review_remarks'];

    protected $casts = [
        'activity_date' => 'date',
        'is_auto_generated' => 'boolean',
    ];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function sourceTask()
    {
        return $this->belongsTo(Task::class, 'source_task_id');
    }

    public function sourceSubtask()
    {
        return $this->belongsTo(Subtask::class, 'source_subtask_id');
    }
}
