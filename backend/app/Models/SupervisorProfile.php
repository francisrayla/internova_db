<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupervisorProfile extends Model
{
    protected $fillable = ['user_id', 'school_id', 'company_id', 'position'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
