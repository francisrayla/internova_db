<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Notification extends Model
{
    protected $fillable = [
        'audience_role', 'school_id', 'user_id',
        'type', 'title', 'body', 'link', 'read_at', 'important',
    ];

    protected $casts = [
        'read_at'   => 'datetime',
        'important' => 'boolean',
    ];

    public function school()
    {
        return $this->belongsTo(School::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
