<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeanFeedback extends Model
{
    protected $table = 'dean_feedback';

    public const OPEN = 'open';
    public const ACKNOWLEDGED = 'acknowledged';
    public const RESOLVED = 'resolved';

    protected $fillable = ['school_id', 'dean_id', 'coordinator_id', 'message', 'read_at', 'status', 'acknowledged_at', 'resolved_at'];

    protected $casts = ['read_at' => 'datetime', 'acknowledged_at' => 'datetime', 'resolved_at' => 'datetime'];

    public function dean()
    {
        return $this->belongsTo(User::class, 'dean_id');
    }

    public function coordinator()
    {
        return $this->belongsTo(User::class, 'coordinator_id');
    }

    public function replies()
    {
        return $this->hasMany(DeanFeedbackReply::class)->orderBy('id');
    }
}
