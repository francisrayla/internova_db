<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TaskAssignee extends Model
{
    protected $fillable = ['task_id', 'deployment_id', 'user_id'];

    public function task()
    {
        return $this->belongsTo(Task::class);
    }

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
