<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SchoolSubscription extends Model
{
    protected $fillable = [
        'school_id', 'plan_id', 'start_date', 'end_date', 'status',
        'list_price', 'amount', 'discount_amount', 'agreement_note',
        'billing_period', 'paid_at',
        'offer_sent_at', 'offer_expires_at', 'accepted_at', 'payment_method', 'payment_status',
        'payment_reference', 'proof_of_payment_path',
    ];

    protected $casts = [
        'start_date'       => 'date',
        'end_date'         => 'date',
        'paid_at'          => 'datetime',
        'offer_sent_at'    => 'datetime',
        'offer_expires_at' => 'datetime',
        'accepted_at'      => 'datetime',
    ];

    const OFFER_PENDING_STATUSES = ['awaiting_acceptance', 'accepted', 'pending_payment'];

    public function plan()
    {
        return $this->belongsTo(SubscriptionPlan::class, 'plan_id');
    }

    public function isOfferExpired(): bool
    {
        return $this->offer_expires_at
            && $this->offer_expires_at->isPast()
            && in_array($this->status, self::OFFER_PENDING_STATUSES, true);
    }

    /**
     * A subscription that went active but whose paid period has lapsed (renewal
     * not paid) — distinct from an offer that expired before ever being paid.
     */
    public function isRenewalExpired(): bool
    {
        return $this->status === 'active' && $this->end_date && $this->end_date->isPast();
    }

    /**
     * The status to show/act on, accounting for lazily-detected expiry
     * (no scheduler needed — expiry is evaluated whenever the record is read).
     */
    public function effectiveStatus(): string
    {
        if ($this->isOfferExpired()) {
            return 'offer_expired';
        }
        if ($this->isRenewalExpired()) {
            return 'expired';
        }
        return $this->status;
    }

    /**
     * Marks the subscription paid and active. A brand-new subscription (start/end
     * still null — a school that hasn't paid yet shouldn't lose part of its year
     * just for taking a while to accept and pay) gets a fresh date window starting
     * today. A mid-cycle upgrade already carries over the current cycle's dates
     * (set when the upgrade was requested) and keeps them unchanged — upgrading
     * doesn't reset or extend how long the subscription runs.
     */
    public function activate(): void
    {
        $end = $this->billing_period === 'monthly' ? now()->addMonth() : now()->addYear();

        $this->update([
            'status'         => 'active',
            'payment_status' => 'paid',
            'paid_at'        => now(),
            'start_date'     => $this->start_date ?? now()->toDateString(),
            'end_date'       => $this->end_date ?? $end->toDateString(),
        ]);
    }
}
