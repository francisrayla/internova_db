<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Subtask extends Model
{
    protected $fillable = ['task_id', 'title', 'description', 'status', 'due_date', 'completed_at'];

    protected $casts = [
        'due_date' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function task()
    {
        return $this->belongsTo(Task::class);
    }

    public function assignees()
    {
        return $this->belongsToMany(User::class, 'subtask_assignees')->withTimestamps();
    }

    public function comments()
    {
        return $this->hasMany(TaskComment::class)->orderBy('created_at');
    }

    public function proofs()
    {
        return $this->hasMany(TaskProof::class)->orderBy('created_at');
    }
}
