<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TaskAttachment extends Model
{
    protected $fillable = ['task_id', 'uploaded_by', 'file_name', 'file_path', 'file_type', 'file_size'];
}
