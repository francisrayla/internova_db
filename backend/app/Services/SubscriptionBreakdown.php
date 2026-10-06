<?php

namespace App\Services;

use App\Models\PaymentTransaction;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;

/**
 * The ONE place that decides what a school pays and why.
 *
 * Checkout, upgrade checkout, the Dean's "before you pay" screen, the offer
 * card and the Super Admin school view all read their numbers from here, so
 * what is shown and what PayMongo is asked to charge cannot diverge.
 *
 * Shape: plan_price, discount, discount_reason, credit, proration_adjustment,
 * total, lines[] (signed amounts that add up to total), line_item_name and
 * description (used for the PayMongo line item).
 */
class SubscriptionBreakdown
{
    public static function money(float $n): string
    {
        return '₱' . number_format($n, fmod($n, 1.0) === 0.0 ? 0 : 2);
    }

    /** Payable breakdown of an offer / a subscription as stored (initial payment). */
    public static function forSubscription(SchoolSubscription $s): array
    {
        if (self::isPeriodUpgrade($s)) {
            return self::periodShape($s);
        }

        $total = round((float) $s->amount, 2);
        $planPrice = round((float) ($s->list_price ?: ($total + (float) $s->discount_amount)), 2);
        $discount = max(0, round($planPrice - $total, 2));
        $planName = $s->plan?->name ?? 'Subscription';
        $period = $s->billing_period ?? 'monthly';

        $lines = [['key' => 'plan', 'label' => "{$planName} plan ({$period})", 'amount' => $planPrice]];
        if ($discount > 0) {
            $lines[] = [
                'key' => 'discount', 'label' => 'Discount', 'amount' => -$discount,
                'note' => $s->agreement_note ?: null,
            ];
        }

        $name = "{$planName} Plan ({$period})";
        if ($discount > 0) {
            $name .= ' — ' . self::money($planPrice) . ' less ' . self::money($discount) . ' discount';
        }

        return [
            'kind'                 => 'subscription',
            'plan_name'            => $planName,
            'billing_period'       => $period,
            'plan_price'           => $planPrice,
            'discount'             => $discount,
            'discount_reason'      => $discount > 0 ? ($s->agreement_note ?: null) : null,
            'credit'               => 0.0,
            'proration_adjustment' => 0.0,
            'remaining_days'       => null,
            'total_days'           => null,
            'total'                => $total,
            'lines'                => $lines,
            'line_item_name'       => $name,
            'description'          => self::describe($lines, $total),
        ];
    }

    /**
     * Pro-rated cost of moving the current paid term to a higher plan — the
     * cycle (start/end) stays, only the plan governing it changes.
     */
    public static function prorate(SchoolSubscription $current, float $newPrice): array
    {
        $oldPrice = SubscriptionPlan::priceForName($current->plan?->name, $current->billing_period);
        $difference = $newPrice - $oldPrice;

        $totalDays = max(1, $current->start_date->diffInDays($current->end_date));
        $remainingDays = min($totalDays, max(0, now()->startOfDay()->diffInDays($current->end_date->copy()->startOfDay())));

        $amountNow = max(0, round($difference * $remainingDays / $totalDays, 2));

        return [
            'old_price'          => $oldPrice,
            'new_price'          => $newPrice,
            'difference'         => $difference,
            'total_days'         => $totalDays,
            'remaining_days'     => $remainingDays,
            'amount_now'         => $amountNow,
            'next_renewal_price' => $newPrice,
            'current_end_date'   => $current->end_date->format('F d, Y'),
        ];
    }

    public static function forUpgrade(SchoolSubscription $current, SubscriptionPlan $newPlan, string $period): array
    {
        $proration = self::prorate($current, $newPlan->priceFor($period));

        return self::upgradeShape(
            $newPlan->name, $period, $proration['new_price'], $proration['old_price'], $proration['amount_now'],
            $current->plan?->name, $proration['remaining_days'], $proration['total_days']
        );
    }

    /** Breakdown of an upgrade payment that was already started (amount = its transaction). */
    public static function forPendingUpgrade(SchoolSubscription $pending): array
    {
        $txn = PaymentTransaction::where('subscription_id', $pending->id)->where('payment_type', 'upgrade')->latest('id')->first();
        // A monthly -> yearly switch, or an approved custom-rate change paid through
        // the normal checkout (no upgrade transaction): its own stored numbers are the truth.
        if (self::isPeriodUpgrade($pending) || !$txn) {
            return self::forSubscription($pending);
        }
        $total = round((float) ($txn?->amount ?? $pending->amount), 2);
        $period = $pending->billing_period;
        $previous = $txn?->previousPlan;
        $oldPrice = $previous ? $previous->priceFor($period) : 0.0;

        return self::upgradeShape(
            $pending->plan?->name ?? 'Plan', $period, (float) $pending->amount, $oldPrice, $total, $previous?->name, null, null
        );
    }

    /** Marker stored in agreement_note on a monthly -> yearly (same plan) payment row. */
    public const PERIOD_UPGRADE_NOTE = 'Credit for the unused part of your current monthly term';

    public static function isPeriodUpgrade(SchoolSubscription $s): bool
    {
        return $s->agreement_note !== null && str_starts_with($s->agreement_note, self::PERIOD_UPGRADE_NOTE);
    }

    /**
     * Same plan, monthly -> yearly: the yearly price minus a credit for the unused
     * days of the monthly term already paid (same day-count proration as upgrades).
     * The yearly term starts when the payment is confirmed.
     */
    public static function forPeriodUpgrade(SchoolSubscription $current, SubscriptionPlan $plan): array
    {
        $yearly = round($plan->priceFor('yearly'), 2);
        $totalDays = max(1, $current->start_date->diffInDays($current->end_date));
        $remaining = min($totalDays, max(0, now()->startOfDay()->diffInDays($current->end_date->copy()->startOfDay())));
        $credit = min($yearly, round((float) $current->amount * $remaining / $totalDays, 2));
        $total = round(max(0, $yearly - $credit), 2);
        $note = self::PERIOD_UPGRADE_NOTE . " ({$remaining} of {$totalDays} days left).";

        $lines = [
            ['key' => 'plan', 'label' => "{$plan->name} plan (yearly)", 'amount' => $yearly],
            ['key' => 'credit', 'label' => 'Credit for your unused monthly term', 'amount' => -$credit, 'note' => $note],
        ];

        return [
            'kind'                 => 'period_upgrade',
            'plan_name'            => $plan->name,
            'billing_period'       => 'yearly',
            'plan_price'           => $yearly,
            'discount'             => 0.0,
            'discount_reason'      => null,
            'credit'               => $credit,
            'proration_adjustment' => 0.0,
            'remaining_days'       => $remaining,
            'total_days'           => $totalDays,
            'total'                => $total,
            'agreement_note'       => $note,
            'monthly_paid'         => round((float) $current->amount, 2),
            'new_term_ends'        => now()->addYear()->format('F d, Y'),
            'lines'                => $lines,
            'line_item_name'       => "{$plan->name} Plan (yearly) — " . self::money($yearly) . ' less ' . self::money($credit) . ' credit for unused monthly term',
            'description'          => self::describe($lines, $total),
        ];
    }

    /** Re-renders a stored monthly -> yearly row (list_price = yearly, discount_amount = credit, amount = payable). */
    private static function periodShape(SchoolSubscription $s): array
    {
        $total = round((float) $s->amount, 2);
        $yearly = round((float) $s->list_price, 2);
        $credit = round((float) $s->discount_amount, 2);
        $name = $s->plan?->name ?? 'Subscription';
        $lines = [
            ['key' => 'plan', 'label' => "{$name} plan (yearly)", 'amount' => $yearly],
            ['key' => 'credit', 'label' => 'Credit for your unused monthly term', 'amount' => -$credit, 'note' => $s->agreement_note],
        ];

        return [
            'kind'                 => 'period_upgrade',
            'plan_name'            => $name,
            'billing_period'       => 'yearly',
            'plan_price'           => $yearly,
            'discount'             => 0.0,
            'discount_reason'      => null,
            'credit'               => $credit,
            'proration_adjustment' => 0.0,
            'remaining_days'       => null,
            'total_days'           => null,
            'total'                => $total,
            'lines'                => $lines,
            'line_item_name'       => "{$name} Plan (yearly) — " . self::money($yearly) . ' less ' . self::money($credit) . ' credit for unused monthly term',
            'description'          => self::describe($lines, $total),
        ];
    }

    private static function upgradeShape(string $planName, string $period, float $newPrice, float $oldPrice, float $total, ?string $oldName, ?int $remaining, ?int $totalDays): array
    {
        $adjustment = round($total - ($newPrice - $oldPrice), 2);
        $lines = [
            ['key' => 'plan', 'label' => "{$planName} plan ({$period})", 'amount' => $newPrice],
            ['key' => 'credit', 'label' => 'Credit for your current ' . ($oldName ?? 'plan'), 'amount' => -$oldPrice],
        ];
        if ($adjustment != 0.0) {
            $lines[] = [
                'key' => 'proration', 'label' => 'Pro-rated for the time left', 'amount' => $adjustment,
                'note' => $remaining !== null ? "Only {$remaining} of {$totalDays} days remain in your current term." : null,
            ];
        }

        return [
            'kind'                 => 'upgrade',
            'plan_name'            => $planName,
            'billing_period'       => $period,
            'plan_price'           => $newPrice,
            'discount'             => 0.0,
            'discount_reason'      => null,
            'credit'               => $oldPrice,
            'proration_adjustment' => $adjustment,
            'remaining_days'       => $remaining,
            'total_days'           => $totalDays,
            'total'                => $total,
            'lines'                => $lines,
            'line_item_name'       => "Upgrade to {$planName} ({$period}) — " . self::money($newPrice) . ' less ' . self::money($oldPrice) . ' current plan credit, prorated',
            'description'          => self::describe($lines, $total),
        ];
    }

    private static function describe(array $lines, float $total): string
    {
        $parts = array_map(fn ($l) => $l['label'] . ': ' . ($l['amount'] < 0 ? '-' : '') . self::money(abs($l['amount'])), $lines);

        return implode('; ', $parts) . '; Total: ' . self::money($total);
    }
}
