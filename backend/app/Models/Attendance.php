<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attendance extends Model
{
    protected $fillable = [
        'deployment_id',
        'attendance_date',
        'clock_in',
        'clock_in_selfie_path',
        'clock_in_latitude',
        'clock_in_longitude',
        'clock_out',
        'clock_out_selfie_path',
        'clock_out_latitude',
        'clock_out_longitude',
        'status',
    ];

    protected $casts = [
        'attendance_date' => 'date',
        'clock_in' => 'datetime',
        'clock_out' => 'datetime',
        'clock_in_latitude' => 'float',
        'clock_in_longitude' => 'float',
        'clock_out_latitude' => 'float',
        'clock_out_longitude' => 'float',
    ];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }
}
