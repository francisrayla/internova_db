<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeanFeedback extends Model
{
    protected $table = 'dean_feedback';

    protected $fillable = ['school_id', 'dean_id', 'coordinator_id', 'message', 'read_at'];

    protected $casts = ['read_at' => 'datetime'];

    public function dean()
    {
        return $this->belongsTo(User::class, 'dean_id');
    }

    public function coordinator()
    {
        return $this->belongsTo(User::class, 'coordinator_id');
    }
}
