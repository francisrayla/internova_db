<?php

namespace App\Services;

use App\Models\School;
use App\Models\SchoolSubscription;
use Illuminate\Support\Facades\DB;

/**
 * Scheduled plan/period switches (a move to a cheaper plan or a shorter billing
 * period) never cut a paid term short: they wait as a 'scheduled' subscription
 * row until the current paid term ends. There is no scheduler in this app, so
 * the hand-over happens lazily the first time the school is read after the end
 * date (School::currentSubscription()).
 *
 * At hand-over the old row becomes 'expired' and the scheduled row becomes an
 * 'accepted' offer awaiting payment, so the Dean pays for it through the normal
 * checkout (price breakdown, PayMongo or bank transfer). Its dates are cleared
 * and set when the payment is confirmed. The school is billed exactly once for
 * the new term, and never for time already paid.
 */
class SubscriptionRollover
{
    public static function scheduledFor(School $school): ?SchoolSubscription
    {
        return $school->subscriptions()->where('status', 'scheduled')->latest('id')->first();
    }

    /** Hands over to the scheduled row when the active term has ended. Returns the row now in charge, or null. */
    public static function apply(School $school, SchoolSubscription $active): ?SchoolSubscription
    {
        if (!$active->isRenewalExpired()) {
            return null;
        }

        $scheduled = self::scheduledFor($school);
        if (!$scheduled) {
            return null;
        }

        // Locked and re-checked: two requests reading the school right after the end date
        // must hand over once (and send one notification), not twice.
        $handedOver = DB::transaction(function () use ($school, $active, $scheduled) {
            School::whereKey($school->id)->lockForUpdate()->first();
            $lockedActive = SchoolSubscription::whereKey($active->id)->lockForUpdate()->first();
            $lockedScheduled = SchoolSubscription::whereKey($scheduled->id)->lockForUpdate()->first();

            if (!$lockedActive || !$lockedScheduled || $lockedActive->status !== 'active' || $lockedScheduled->status !== 'scheduled') {
                return false;
            }

            $lockedActive->update(['status' => 'expired']);
            $lockedScheduled->update([
                'status'         => 'accepted',
                'payment_status' => null,
                'start_date'     => null,
                'end_date'       => null,
                'accepted_at'    => now(),
            ]);
            $school->update(['status' => 'accepted']);

            return true;
        });

        if (!$handedOver) {
            // Someone else just did it (the row is now the accepted offer), or it was cancelled meanwhile.
            $now = $scheduled->fresh();

            return $now && $now->status === 'accepted' ? $now : null;
        }

        $plan = $scheduled->plan?->name ?? 'new plan';
        NotificationService::toSchoolDean(
            $school->id,
            'plan_switch_due',
            'Your plan switch is ready to pay',
            "Your paid term ended. Pay for {$plan} ({$scheduled->billing_period}) to continue.",
            '/dean/billing'
        );

        return $scheduled->fresh();
    }

    /** Dean-facing / admin-facing summary of a scheduled switch. */
    public static function summary(?SchoolSubscription $scheduled): ?array
    {
        if (!$scheduled) {
            return null;
        }

        return [
            'id'             => $scheduled->id,
            'plan'           => $scheduled->plan?->name,
            'billing_period' => $scheduled->billing_period,
            'amount'         => (float) $scheduled->amount,
            'starts_on'      => $scheduled->start_date?->format('F d, Y'),
            'breakdown'      => SubscriptionBreakdown::forSubscription($scheduled),
        ];
    }
}
