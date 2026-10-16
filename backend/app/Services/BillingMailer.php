<?php

namespace App\Services;

use App\Mail\PaymentReceipt;
use App\Mail\SubscriptionOfferReady;
use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\User;
use App\Support\HeadTitle;
use App\Support\MailBrand;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Billing emails to the school head: the subscription offer (when the Super Admin approves a registration or
 * resends an expired offer) and the payment receipt (once, when PaymentActivation turns a subscription active).
 * A mail problem is logged and never stops the approval or the activation that triggered it.
 */
class BillingMailer
{
    private const METHOD_LABELS = [
        'gcash' => 'GCash',
        'maya' => 'Maya',
        'card' => 'Card',
        'bank_transfer' => 'Bank transfer',
        'manual' => 'Payment recorded by Internova',
    ];

    /** @param iterable<User>|null $recipients defaults to the school's active head accounts */
    public static function sendOffer(School $school, ?SchoolSubscription $subscription, ?iterable $recipients = null, bool $resent = false): void
    {
        if (!$subscription) {
            return;
        }
        $plan = $subscription->plan?->name ?? 'Internova';
        $discount = (float) ($subscription->discount_amount ?? 0);
        foreach ($recipients ?? MailBrand::headsOf($school->id) as $user) {
            if (!self::canEmail($user)) {
                continue;
            }
            self::queue($user, new SubscriptionOfferReady(
                recipientName: self::nameOf($user),
                headTitle: HeadTitle::forSchool($school->id),
                schoolName: $school->school_name,
                planName: $plan,
                billingPeriod: self::periodLabel($subscription->billing_period),
                amount: self::money($subscription->amount),
                listPrice: $discount > 0 ? self::money($subscription->list_price) : null,
                discount: $discount > 0 ? self::money($discount) : null,
                expiresOn: self::date($subscription->offer_expires_at),
                billingUrl: MailBrand::appUrl('/dean/billing'),
                resent: $resent,
            ), 'offer');
        }
    }

    public static function sendReceipt(SchoolSubscription $subscription): void
    {
        $school = School::find($subscription->school_id);
        if (!$school) {
            return;
        }
        $txn = PaymentTransaction::where('subscription_id', $subscription->id)->where('status', 'paid')->latest('id')->first();
        $method = $txn?->payment_method ?? $subscription->payment_method;
        $receipt = $subscription->payment_reference ?: 'SUB-' . $subscription->id;
        foreach (MailBrand::headsOf($school->id) as $user) {
            if (!self::canEmail($user)) {
                continue;
            }
            self::queue($user, new PaymentReceipt(
                recipientName: self::nameOf($user),
                schoolName: $school->school_name,
                receiptNumber: $receipt,
                planName: $subscription->plan?->name ?? 'Internova',
                billingPeriod: self::periodLabel($subscription->billing_period),
                amount: self::money($txn?->amount ?? $subscription->amount),
                methodLabel: self::METHOD_LABELS[$method] ?? ($method ? ucfirst(str_replace('_', ' ', $method)) : 'Payment'),
                paidOn: self::date($txn?->paid_at ?? $subscription->paid_at ?? now()),
                validFrom: self::date($subscription->start_date),
                validUntil: self::date($subscription->end_date),
                billingUrl: MailBrand::appUrl('/dean/billing'),
            ), 'receipt');
        }
    }

    private static function queue(User $user, $mailable, string $kind): void
    {
        try {
            Mail::to($user->email, self::nameOf($user))->queue($mailable);
        } catch (\Throwable $e) {
            Log::warning("Billing {$kind} email could not be queued", ['user_id' => $user->id, 'error' => $e->getMessage()]);
        }
    }

    /** Bounced addresses (Resend webhook) are skipped so a bad inbox does not keep bouncing. */
    private static function canEmail(?User $user): bool
    {
        return $user && filled($user->email) && empty($user->email_bounced_at);
    }

    private static function nameOf(User $user): string
    {
        return trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) ?: ($user->name ?? 'there');
    }

    private static function periodLabel(?string $period): string
    {
        return $period === 'yearly' ? 'yearly' : 'monthly';
    }

    private static function money($value): string
    {
        return number_format((float) $value, 2);
    }

    private static function date($value): ?string
    {
        if (!$value) {
            return null;
        }

        return Carbon::parse($value)->timezone('Asia/Manila')->format('M j, Y');
    }
}
