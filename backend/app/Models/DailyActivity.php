<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyActivity extends Model
{
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
