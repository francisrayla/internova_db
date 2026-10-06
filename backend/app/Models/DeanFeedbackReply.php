<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeanFeedbackReply extends Model
{
    protected $fillable = ['dean_feedback_id', 'user_id', 'sender_role', 'message', 'read_at'];

    protected $casts = ['read_at' => 'datetime'];

    public function feedback()
    {
        return $this->belongsTo(DeanFeedback::class, 'dean_feedback_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
