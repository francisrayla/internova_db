<?php

namespace App\Services;

use App\Models\PaymentTransaction;
use App\Models\School;
use App\Support\MailBrand;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * The payment receipt Internova issues for every paid subscription payment, whatever the method
 * (GCash, Maya, card, bank transfer, a manual confirmation or a waived ₱0 plan). Built from the paid
 * payment_transactions row, so the Dean's billing page, the Super Admin's school page and the
 * receipt email all show the same receipt number and amounts.
 *
 * It is a payment receipt from the platform, not a BIR official receipt.
 */
class PaymentReceipts
{
    public const METHOD_LABELS = [
        'gcash' => 'GCash',
        'maya' => 'Maya',
        'card' => 'Debit / credit card',
        'bank_transfer' => 'Bank transfer',
        'manual' => 'Payment recorded by Internova',
        'waived' => 'Waived (no payment due)',
    ];

    private const TYPE_LABELS = [
        'initial' => 'New subscription',
        'renewal' => 'Renewal',
        'upgrade' => 'Plan upgrade',
    ];

    /** Receipt number: IN-<year paid>-<transaction id, 6 digits>, e.g. IN-2026-000123. */
    public static function number(PaymentTransaction $txn): string
    {
        $year = ($txn->paid_at ?? $txn->created_at ?? now())->timezone('Asia/Manila')->format('Y');

        return 'IN-' . $year . '-' . str_pad((string) $txn->id, 6, '0', STR_PAD_LEFT);
    }

    public static function methodLabel(?string $method): string
    {
        return self::METHOD_LABELS[$method] ?? ($method ? ucfirst(str_replace('_', ' ', $method)) : 'Payment');
    }

    /** Short rows for a list (newest first): every paid payment of the school. */
    public static function listFor(int $schoolId): Collection
    {
        return PaymentTransaction::with(['subscription.plan', 'newPlan'])
            ->where('school_id', $schoolId)
            ->where('status', 'paid')
            ->orderByDesc('paid_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (PaymentTransaction $t) => [
                'id' => $t->id,
                'receipt_number' => self::number($t),
                'paid_at' => self::date($t->paid_at),
                'plan' => self::planName($t),
                'type' => self::TYPE_LABELS[$t->payment_type] ?? ucfirst((string) $t->payment_type),
                'method' => self::methodLabel($t->payment_method),
                'amount' => round((float) $t->amount, 2),
            ])
            ->values();
    }

    /** The full receipt of one paid payment of this school, or null when there is none. */
    public static function find(int $schoolId, int $transactionId): ?array
    {
        $txn = PaymentTransaction::with(['subscription.plan', 'newPlan', 'previousPlan'])
            ->where('school_id', $schoolId)
            ->where('status', 'paid')
            ->find($transactionId);

        return $txn ? self::forTransaction($txn) : null;
    }

    public static function forTransaction(PaymentTransaction $txn): array
    {
        $school = School::find($txn->school_id);
        $subscription = $txn->subscription;
        $amount = round((float) $txn->amount, 2);

        $breakdown = null;
        if ($subscription) {
            $breakdown = $txn->payment_type === 'upgrade'
                ? SubscriptionBreakdown::forPendingUpgrade($subscription)
                : SubscriptionBreakdown::forSubscription($subscription);
        }
        // The stored breakdown must add up to what was actually paid; otherwise show the payment as one line.
        $lines = $breakdown && abs((float) $breakdown['total'] - $amount) < 0.01
            ? array_map(fn ($l) => ['label' => $l['label'], 'amount' => round((float) $l['amount'], 2)], $breakdown['lines'])
            : [['label' => self::planName($txn) . ' plan' . ($subscription?->billing_period ? " ({$subscription->billing_period})" : ''), 'amount' => $amount]];

        $head = $school ? MailBrand::headsOf($school->id)->first() : null;
        $reference = $txn->gateway_reference ?: $subscription?->payment_reference;

        return [
            'id' => $txn->id,
            'receipt_number' => self::number($txn),
            'status' => 'Paid',
            'paid_at' => self::date($txn->paid_at),
            'issued_by' => [
                'name' => 'Internova',
                'email' => MailBrand::supportEmail(),
            ],
            'billed_to' => [
                'school' => $school?->school_name,
                'address' => $school?->address,
                'name' => $head ? trim(($head->first_name ?? '') . ' ' . ($head->last_name ?? '')) : null,
                'email' => $head?->email,
            ],
            'type' => self::TYPE_LABELS[$txn->payment_type] ?? ucfirst((string) $txn->payment_type),
            'plan' => self::planName($txn),
            'billing_period' => $subscription?->billing_period,
            'covers_from' => self::day($subscription?->start_date),
            'covers_until' => self::day($subscription?->end_date),
            'method' => self::methodLabel($txn->payment_method),
            // a PayMongo checkout id or the bank-transfer reference code the Dean was given
            'reference' => $reference,
            'lines' => $lines,
            'total' => $amount,
            'currency' => 'PHP',
        ];
    }

    private static function planName(PaymentTransaction $txn): string
    {
        return $txn->newPlan?->name ?? $txn->subscription?->plan?->name ?? 'Internova';
    }

    private static function date($value): ?string
    {
        return $value ? Carbon::parse($value)->timezone('Asia/Manila')->format('M j, Y g:i A') : null;
    }

    /** start_date / end_date are calendar days: no time, no timezone shift. */
    private static function day($value): ?string
    {
        return $value ? Carbon::parse($value)->format('M j, Y') : null;
    }
}
