<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PlanInquiry extends Model
{
    use HasFactory;

    protected $fillable = [
        'school_name', 'school_type', 'address', 'website',
        'contact_person', 'position', 'email', 'phone',
        'intern_range', 'expected_coordinators', 'interested_plan',
        'heard_from', 'message', 'status', 'notes', 'school_id', 'user_id',
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
