<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InternshipDeployment extends Model
{
    protected $fillable = ['school_id', 'intern_id', 'company_id', 'supervisor_id', 'coordinator_id', 'start_date', 'end_date', 'required_hours', 'status'];

    protected $casts = [
        'start_date' => 'date',
        'end_date' => 'date',
    ];

    public function school()
    {
        return $this->belongsTo(School::class);
    }

    public function intern()
    {
        return $this->belongsTo(User::class, 'intern_id');
    }

    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    public function supervisor()
    {
        return $this->belongsTo(User::class, 'supervisor_id');
    }

    public function coordinator()
    {
        return $this->belongsTo(User::class, 'coordinator_id');
    }
}
