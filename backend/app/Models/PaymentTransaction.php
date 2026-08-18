<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PaymentTransaction extends Model
{
    protected $fillable = [
        'school_id', 'subscription_id', 'payment_type',
        'previous_plan_id', 'new_plan_id', 'payment_method',
        'amount', 'status', 'gateway_reference', 'proof_path', 'paid_at',
    ];

    protected $casts = [
        'paid_at' => 'datetime',
    ];

    public function school()
    {
        return $this->belongsTo(School::class);
    }

    public function subscription()
    {
        return $this->belongsTo(SchoolSubscription::class, 'subscription_id');
    }

    public function previousPlan()
    {
        return $this->belongsTo(SubscriptionPlan::class, 'previous_plan_id');
    }

    public function newPlan()
    {
        return $this->belongsTo(SubscriptionPlan::class, 'new_plan_id');
    }
}
