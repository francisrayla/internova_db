<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeanProfile extends Model
{
    protected $fillable = ['user_id', 'school_id', 'position', 'weekly_summary_email'];

    protected $casts = ['weekly_summary_email' => 'boolean'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
