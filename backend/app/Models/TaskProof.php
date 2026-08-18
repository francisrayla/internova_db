<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TaskProof extends Model
{
    protected $fillable = ['task_id', 'subtask_id', 'uploaded_by', 'file_path', 'file_name', 'mime_type', 'size'];

    public function task()
    {
        return $this->belongsTo(Task::class);
    }

    public function subtask()
    {
        return $this->belongsTo(Subtask::class);
    }

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
