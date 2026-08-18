<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SubscriptionPlan extends Model
{
    protected $fillable = [
        'name', 'description', 'monthly_price', 'yearly_price', 'features', 'is_active',
    ];

    protected $casts = [
        'features'  => 'array',
        'is_active' => 'boolean',
    ];

    /**
     * The real charge for a billing period — the single source of truth for
     * pricing across checkout, upgrades, plan switches, and Super Admin
     * plan-change approvals. Editing a plan here is what actually changes
     * what schools pay on their next purchase or upgrade.
     */
    public function priceFor(string $billingPeriod): float
    {
        return (float) ($billingPeriod === 'monthly' ? $this->monthly_price : $this->yearly_price);
    }

    public static function priceForName(string $name, string $billingPeriod): float
    {
        $plan = static::where('name', $name)->firstOrFail();
        return $plan->priceFor($billingPeriod);
    }

    /**
     * For self-service entry points (upgrade / switch) where a Super Admin
     * hiding a plan via the Plans screen should actually stop new coordinators
     * from choosing it — unlike priceForName(), used where a request already
     * targets a specific plan regardless of its current visibility (e.g. a
     * Super Admin approving a custom-rate change a coordinator already asked for).
     */
    public static function activeOrFail(string $name): self
    {
        $plan = static::where('name', $name)->firstOrFail();
        abort_if(!$plan->is_active, 422, "The {$name} plan isn't currently available.");
        return $plan;
    }
}
