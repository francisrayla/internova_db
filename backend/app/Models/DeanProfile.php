<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeanProfile extends Model
{
    protected $fillable = ['user_id', 'school_id', 'position'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
