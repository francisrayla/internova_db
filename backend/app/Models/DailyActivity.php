<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyActivity extends Model
{
    protected $fillable = ['deployment_id', 'activity_date', 'title', 'description', 'hours_rendered', 'photo_path', 'status', 'reviewed_by', 'review_remarks'];

    protected $casts = [
        'activity_date' => 'date',
        'hours_rendered' => 'decimal:2',
    ];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }
}
