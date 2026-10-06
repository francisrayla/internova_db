<?php

namespace App\Services;

use App\Models\PaymentTransaction;
use App\Models\SchoolSubscription;
use App\Support\LocalTime;
use Illuminate\Support\Carbon;

/**
 * Super Admin revenue figures, computed from money that was actually paid.
 *
 * Source of truth: payment_transactions rows with status 'paid'. Every real
 * payment path writes one (PayMongo verifyCheckout, Super Admin verify /
 * confirm of a bank transfer, paid upgrades; confirmSchoolPayment creates one
 * if a manual confirmation has none). Their amount is what was really charged,
 * e.g. the prorated amount of an upgrade, not the new plan's list price.
 * A school_subscriptions row marked "paid" without a paid transaction (an
 * instant plan switch or an approved custom-rate change) moved no money, so it
 * is listed in the breakdown as "not recorded" but never counted.
 */
class RevenueReportService
{
    public function report(): array
    {
        $now = LocalTime::now();
        $thisStart = $now->copy()->startOfMonth()->utc();
        $nextStart = $now->copy()->startOfMonth()->addMonth()->utc();
        $lastStart = $now->copy()->startOfMonth()->subMonth()->utc();

        $paid = PaymentTransaction::where('status', 'paid')->get();
        $when = fn (PaymentTransaction $t): Carbon => ($t->paid_at ?? $t->updated_at)->copy();

        $sumBetween = fn (Carbon $from, Carbon $to) => round($paid
            ->filter(fn ($t) => $when($t)->gte($from) && $when($t)->lt($to))
            ->sum(fn ($t) => (float) $t->amount), 2);

        $today = LocalTime::today();
        $active = SchoolSubscription::where('status', 'active')
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $today))
            ->get();
        $recurring = round($active->sum(
            fn ($s) => $s->billing_period === 'yearly' ? (float) $s->amount / 12 : (float) $s->amount
        ), 2);

        return [
            'currency'                   => 'PHP',
            'collected_this_month'       => $sumBetween($thisStart, $nextStart),
            'collected_last_month'       => $sumBetween($lastStart, $thisStart),
            'total_collected'            => round($paid->sum(fn ($t) => (float) $t->amount), 2),
            'recurring_monthly'          => $recurring,
            'active_subscriptions'       => $active->count(),
            'this_month_label'           => $now->format('F Y'),
            'last_month_label'           => $now->copy()->subMonthNoOverflow()->format('F Y'),
            'breakdown'                  => $this->breakdown($paid),
        ];
    }

    private function breakdown($paid): array
    {
        $bySub = $paid->groupBy('subscription_id');

        $subs = SchoolSubscription::with(['school', 'plan'])
            ->where(fn ($q) => $q->whereIn('id', $paid->pluck('subscription_id')->filter()->unique())
                ->orWhere('payment_status', 'paid'))
            ->get();

        return $subs->map(function (SchoolSubscription $s) use ($bySub) {
            $txns = $bySub->get($s->id, collect());
            $paidAt = $txns->map(fn ($t) => $t->paid_at ?? $t->updated_at)->max() ?? $s->paid_at;

            return [
                'subscription_id' => $s->id,
                'school'          => $s->school?->school_name,
                'school_id'       => $s->school_id,
                'plan'            => $s->plan?->name,
                'billing_period'  => $s->billing_period,
                'list_price'      => (float) $s->list_price,
                'discount'        => (float) $s->discount_amount,
                'amount'          => (float) $s->amount,
                'amount_paid'     => round($txns->sum(fn ($t) => (float) $t->amount), 2),
                'paid_at'         => LocalTime::format($paidAt, 'M d, Y · g:i A'),
                'paid_at_sort'    => $paidAt?->toIso8601String(),
                'method'          => $txns->first()?->payment_method ?? $s->payment_method,
                'status'          => $s->status,
                'recorded'        => $txns->isNotEmpty(),
            ];
        })->sortByDesc('paid_at_sort')->values()->map(function ($r) {
            unset($r['paid_at_sort']);
            return $r;
        })->all();
    }
}
