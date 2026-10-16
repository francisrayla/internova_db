<?php

namespace App\Services;

use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The single place a paid subscription turns active. The PayMongo return flow
 * (verify-checkout), the PayMongo webhook, the Super Admin bank-transfer
 * verification and the manual "Confirm Payment" override all call activate(),
 * so a payment can never be applied twice or leave duplicate payment rows:
 * the subscription row is locked, an already-active row is a no-op, and the
 * paid transaction is reused instead of inserted again.
 */
class PaymentActivation
{
    public const ACTIVATED = 'activated';
    public const ALREADY_ACTIVE = 'already_active';
    public const NOT_PAYABLE = 'not_payable';

    /** Rows that were dropped on purpose; a payment can no longer switch them on. */
    private const DEAD_STATUSES = ['cancelled', 'superseded', 'scheduled'];

    /**
     * @return array{result: string, subscription: ?SchoolSubscription}
     */
    public static function activate(SchoolSubscription $subscription, ?string $gatewayReference = null): array
    {
        $outcome = self::activateInTransaction($subscription, $gatewayReference);
        // Exactly one receipt: only the call that actually switched the subscription on sends it
        // (a webhook arriving after the return flow gets ALREADY_ACTIVE and sends nothing).
        if ($outcome['result'] === self::ACTIVATED && $outcome['subscription']) {
            BillingMailer::sendReceipt($outcome['subscription']);
        }

        return $outcome;
    }

    /** @return array{result: string, subscription: ?SchoolSubscription} */
    private static function activateInTransaction(SchoolSubscription $subscription, ?string $gatewayReference): array
    {
        return DB::transaction(function () use ($subscription, $gatewayReference) {
            // School first, then subscription: the same order everywhere keeps two
            // simultaneous payments for one school from deadlocking each other.
            School::whereKey($subscription->school_id)->lockForUpdate()->first();
            $locked = SchoolSubscription::whereKey($subscription->id)->lockForUpdate()->first();

            if (!$locked || in_array($locked->status, self::DEAD_STATUSES, true)) {
                return ['result' => self::NOT_PAYABLE, 'subscription' => $locked];
            }

            if ($locked->status === 'active' && $locked->payment_status === 'paid') {
                return ['result' => self::ALREADY_ACTIVE, 'subscription' => $locked];
            }

            $locked->activate();

            School::whereKey($locked->school_id)->update(['status' => 'active']);
            SchoolSubscription::where('school_id', $locked->school_id)
                ->where('status', 'active')
                ->where('id', '!=', $locked->id)
                ->update(['status' => 'superseded']);

            self::settleTransactions($locked, $gatewayReference);

            return ['result' => self::ACTIVATED, 'subscription' => $locked->fresh()];
        });
    }

    /**
     * Exactly one paid transaction per activation: the one that matches the
     * gateway reference (or the open one), with any other still-open rows for the
     * same subscription closed as cancelled. When no checkout was ever started
     * (manual confirmation) one paid row is created.
     */
    private static function settleTransactions(SchoolSubscription $subscription, ?string $gatewayReference): void
    {
        $open = PaymentTransaction::where('subscription_id', $subscription->id)
            ->whereIn('status', ['pending', 'pending_verification', 'failed', 'expired'])
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $match = $gatewayReference ? $open->firstWhere('gateway_reference', $gatewayReference) : null;
        $match ??= $open->firstWhere('status', 'pending_verification') ?? $open->last();

        if ($match) {
            $match->update(['status' => 'paid', 'paid_at' => now()]);
            foreach ($open->where('id', '!=', $match->id) as $other) {
                $other->update(['status' => 'cancelled']);
            }
            return;
        }

        $alreadyPaid = PaymentTransaction::where('subscription_id', $subscription->id)->where('status', 'paid')->exists();
        if (!$alreadyPaid) {
            PaymentTransaction::create([
                'school_id'         => $subscription->school_id,
                'subscription_id'   => $subscription->id,
                'payment_type'      => 'initial',
                'new_plan_id'       => $subscription->plan_id,
                'payment_method'    => $subscription->payment_method ?? 'manual',
                'amount'            => $subscription->amount,
                'status'            => 'paid',
                'gateway_reference' => $gatewayReference,
                'paid_at'           => now(),
            ]);
        }
    }

    /** Notifications and audit trail for a confirmed online (PayMongo) payment; call only when ACTIVATED. */
    public static function announceOnlinePayment(School $school, SchoolSubscription $subscription, string $via, ?Request $request = null): void
    {
        NotificationService::toSuperadmin(
            'payment_confirmed',
            'Payment confirmed',
            "{$school->school_name} paid via {$subscription->payment_method} and is now active.",
            '/superadmin/schools?highlight=' . $school->id
        );

        // The Dean who pays and comes back sees the receipt; one who closed the tab
        // (confirmed by the webhook alone) needs to be told.
        if ($via === 'webhook') {
            NotificationService::toSchoolDean(
                $school->id,
                'payment_confirmed',
                'Payment received',
                'Your payment was received and your subscription is now active.',
                '/dean/billing'
            );
        }

        ActivityLogService::record(
            module: 'Payment',
            action: 'Paid via ' . $subscription->payment_method,
            description: "{$school->school_name}'s subscription is now active ({$via}).",
            schoolId: $school->id,
            request: $request
        );
    }
}
