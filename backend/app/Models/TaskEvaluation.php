<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TaskEvaluation extends Model
{
    protected $fillable = ['task_id', 'evaluator_id', 'rating', 'comments', 'evaluated_at', 'status'];

    protected $casts = [
        'evaluated_at' => 'datetime',
    ];

    public function task()
    {
        return $this->belongsTo(Task::class);
    }

    public function evaluator()
    {
        return $this->belongsTo(User::class, 'evaluator_id');
    }
}
