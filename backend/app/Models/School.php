<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class School extends Model
{
    protected $fillable = [
        'school_code',
        'school_name',
        'address',
        'contact_email',
        'contact_number',
        'status',
        'is_suspended',
        'suspended_at',
    ];

    protected $casts = [
        'is_suspended' => 'boolean',
        'suspended_at' => 'datetime',
    ];

    public function coordinatorProfiles()
    {
        return $this->hasMany(CoordinatorProfile::class);
    }

    public function subscriptions()
    {
        return $this->hasMany(SchoolSubscription::class);
    }

    public function users()
    {
        return $this->hasMany(User::class);
    }

    public function paymentTransactions()
    {
        return $this->hasMany(PaymentTransaction::class);
    }

    /**
     * The subscription that actually governs current access — the newest
     * active row if one exists, otherwise whatever the newest row is (an
     * offer awaiting acceptance/payment before the school was ever active).
     * A pending upgrade payment must never override this, or a coordinator
     * would lose access to their current plan just for starting an upgrade.
     */
    public function currentSubscription()
    {
        return $this->subscriptions()->where('status', 'active')->latest('id')->first()
            ?? $this->subscriptions()->latest('id')->first();
    }

    /**
     * An upgrade payment in progress while the current plan is still active —
     * null once it's confirmed (it becomes the new currentSubscription) or if
     * no upgrade has been started.
     */
    public function pendingUpgrade()
    {
        $current = $this->currentSubscription();

        if (!$current || $current->status !== 'active') {
            return null;
        }

        return $this->subscriptions()
            ->where('id', '>', $current->id)
            ->where('status', 'pending_payment')
            ->latest('id')
            ->first();
    }
}
