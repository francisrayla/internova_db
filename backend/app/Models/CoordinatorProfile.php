<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CoordinatorProfile extends Model
{
    protected $fillable = ['user_id', 'school_id', 'position', 'is_primary_coordinator'];

    protected $casts = [
        'is_primary_coordinator' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
