<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanChangeRequest extends Model
{
    protected $fillable = [
        'school_id', 'requested_plan', 'requested_billing_period',
        'note', 'status', 'discount_amount', 'reviewed_at',
    ];

    protected $casts = [
        'reviewed_at' => 'datetime',
    ];

    public function school()
    {
        return $this->belongsTo(School::class);
    }
}
