<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Services\ActivityLogService;
use App\Services\NotificationService;
use App\Services\PayMongoService;
use App\Services\PaymentActivation;
use App\Services\SubscriptionBreakdown;
use App\Services\SubscriptionRollover;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Self-service subscription actions for the school's Dean:
 * review/accept the subscription offer, pay, and upload proof of payment.
 */
class DeanSubscriptionController extends Controller
{
    /**
     * Bank details shown to schools that choose manual bank transfer.
     * Placeholder until real merchant details are configured.
     */
    private const BANK_DETAILS = [
        'bank_name'     => 'BDO Unibank',
        'account_name'  => 'Internova Technologies Inc.',
        'account_number'=> '0012-3456-7890',
    ];

    private function latestSubscription(School $school)
    {
        return $school->latestBillableSubscription();
    }

    /**
     * The newest payable row, read with a row lock so two simultaneous requests
     * (a double click, two tabs, the webhook) cannot both act on the same state.
     * Must be called inside DB::transaction. The school row is locked first - the
     * same order PaymentActivation uses - so the two can never deadlock.
     */
    private function lockedSubscription(School $school): ?SchoolSubscription
    {
        School::whereKey($school->id)->lockForUpdate()->first();

        return $school->subscriptions()->where('status', '!=', 'scheduled')->latest('id')->lockForUpdate()->first();
    }

    private function unavailable(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Online payment is unavailable right now. Please try again later or choose Bank Transfer.',
        ], 502);
    }

    /**
     * One open PayMongo checkout per payable subscription - the guard against paying twice.
     * An open session for the same method and amount is handed back instead of creating a
     * new one; a different method closes the old session first; a session PayMongo already
     * reports as paid is activated instead of charged again.
     *
     * @return array{url?: string, paid?: bool, error?: JsonResponse}
     */
    private function openOnlineSession(School $school, SchoolSubscription $subscription, string $method, float $amount, string $paymentType, ?int $previousPlanId, string $reference, array $breakdown): array
    {
        // 'failed' = one payment attempt failed, but its session is still open and payable.
        $open = PaymentTransaction::where('subscription_id', $subscription->id)
            ->whereIn('status', ['pending', 'failed'])
            ->orderByDesc('id')
            ->get();

        foreach ($open as $txn) {
            $existingRef = (string) $txn->gateway_reference;

            // An unfinished bank-transfer reference: the Dean chose to pay online instead.
            if (!str_starts_with($existingRef, 'cs_')) {
                $txn->update(['status' => 'cancelled']);
                continue;
            }

            $session = PayMongoService::retrieveCheckoutSession($existingRef);
            if (!$session) {
                // Cannot tell whether the old session was already paid - do not risk a second charge.
                return ['error' => $this->unavailable()];
            }

            if (PayMongoService::sessionIsPaid($session)) {
                return ['paid' => true, 'reference' => $existingRef];
            }

            $url = data_get($session, 'attributes.checkout_url');
            $isOpen = data_get($session, 'attributes.status') !== 'expired' && $url;
            if ($isOpen && $txn->payment_method === $method && abs((float) $txn->amount - $amount) < 0.005) {
                $txn->update(['status' => 'pending']);
                $subscription->update(['payment_method' => $method, 'payment_status' => 'pending', 'payment_reference' => $existingRef]);
                return ['url' => $url];
            }

            PayMongoService::expireCheckoutSession($existingRef);
            $txn->update(['status' => data_get($session, 'attributes.status') === 'expired' ? 'expired' : 'cancelled']);
        }

        $session = PayMongoService::createCheckoutSession($school, $breakdown['line_item_name'], $amount, $method, $reference, $breakdown['description']);
        if (!$session) {
            return ['error' => $this->unavailable()];
        }

        $subscription->update(['payment_method' => $method, 'payment_status' => 'pending', 'payment_reference' => $session['id']]);

        PaymentTransaction::create([
            'school_id'         => $school->id,
            'subscription_id'   => $subscription->id,
            'payment_type'      => $paymentType,
            'previous_plan_id'  => $previousPlanId,
            'new_plan_id'       => $subscription->plan_id,
            'payment_method'    => $method,
            'amount'            => $amount,
            'status'            => 'pending',
            'gateway_reference' => $session['id'],
        ]);

        return ['url' => $session['attributes']['checkout_url']];
    }

    /**
     * A school pays only for the remaining time in its current billing cycle when
     * upgrading, not the new plan's full price again — the cycle itself (start/end
     * date) doesn't change, only which plan governs it from today onward.
     */
    private function calculateProration($current, float $newPrice): array
    {
        return SubscriptionBreakdown::prorate($current, $newPrice);
    }

    /** Same plan, monthly term -> yearly term (self-service, paid now with a credit for the unused days). */
    private function isPeriodUpgrade($current, array $data): bool
    {
        return $current->billing_period === 'monthly'
            && $data['billing_period'] === 'yearly'
            && $current->plan?->name === $data['plan_name'];
    }

    /**
     * Preview the prorated cost of upgrading before the coordinator commits to a
     * payment method — shown on the "Upgrade to X" confirmation screen.
     */
    public function upgradeQuote(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $current = $school->currentSubscription();

        if (!$current || $current->status !== 'active') {
            return response()->json(['success' => false, 'message' => 'No active subscription to upgrade from.'], 422);
        }

        $data = $request->validate([
            'plan_name'      => 'required|string|in:Basic,Premium',
            'billing_period' => 'required|string|in:monthly,yearly',
        ]);

        if ($this->isPeriodUpgrade($current, $data)) {
            $plan = SubscriptionPlan::activeOrFail($data['plan_name']);
            $breakdown = SubscriptionBreakdown::forPeriodUpgrade($current, $plan);

            return response()->json([
                'success'   => true,
                'kind'      => 'period_upgrade',
                'quote'     => [
                    'old_price'          => (float) $current->amount,
                    'new_price'          => $breakdown['plan_price'],
                    'remaining_days'     => $breakdown['remaining_days'],
                    'total_days'         => $breakdown['total_days'],
                    'amount_now'         => $breakdown['total'],
                    'next_renewal_price' => $breakdown['plan_price'],
                    'current_end_date'   => $breakdown['new_term_ends'],
                ],
                'breakdown' => $breakdown,
            ]);
        }

        if ($data['billing_period'] !== $current->billing_period) {
            return response()->json(['success' => false, 'message' => 'An upgrade keeps your current billing period. Switch billing period separately once your current cycle ends.'], 422);
        }

        $plan = SubscriptionPlan::activeOrFail($data['plan_name']);
        $newPrice = $plan->priceFor($data['billing_period']);

        if ($newPrice <= (float) $current->amount) {
            return response()->json(['success' => false, 'message' => 'That is not an upgrade — use the Switch Plan option instead.'], 422);
        }

        return response()->json([
            'success'   => true,
            'quote'     => $this->calculateProration($current, $newPrice),
            'breakdown' => SubscriptionBreakdown::forUpgrade($current, $plan, $data['billing_period']),
        ]);
    }

    /**
     * If the offer sat unanswered past its expiry window, mark it expired and
     * block the action instead of letting a stale offer be accepted/paid.
     */
    private function rejectIfExpired($subscription, School $school): ?JsonResponse
    {
        if ($subscription->isOfferExpired()) {
            $subscription->update(['status' => 'offer_expired']);
            $school->update(['status' => 'offer_expired']);

            return response()->json([
                'success' => false,
                'message' => 'This subscription offer has expired. Please contact the Super Admin for a new offer.',
            ], 422);
        }

        return null;
    }

    public function acceptOffer(int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        return DB::transaction(function () use ($school) {
            $subscription = $this->lockedSubscription($school);

            if (!$subscription || $subscription->status !== 'awaiting_acceptance') {
                return response()->json(['success' => false, 'message' => 'No subscription offer is awaiting your acceptance.'], 422);
            }

            if ($expired = $this->rejectIfExpired($subscription, $school)) {
                return $expired;
            }

            $subscription->update(['status' => 'accepted', 'accepted_at' => now()]);
            $school->update(['status' => 'accepted']);

            return response()->json(['success' => true, 'message' => 'Offer accepted. Choose a payment method to continue.']);
        });
    }

    /**
     * Closes every open PayMongo checkout of a subscription before the Dean pays another
     * way (so the same invoice can never be paid twice). A session PayMongo reports as
     * already paid is returned instead of being closed.
     *
     * @return array{paid?: bool, reference?: string, error?: JsonResponse}
     */
    private function closeOnlineSessions(SchoolSubscription $subscription, bool $strict = true): array
    {
        $open = PaymentTransaction::where('subscription_id', $subscription->id)
            ->whereIn('status', ['pending', 'failed'])
            ->where('gateway_reference', 'like', 'cs_%')
            ->get();

        foreach ($open as $txn) {
            $session = PayMongoService::retrieveCheckoutSession((string) $txn->gateway_reference);
            if (!$session && $strict) {
                return ['error' => response()->json(['success' => false, 'message' => 'Could not check your earlier online payment right now. Please try again in a moment.'], 502)];
            }
            if ($session && PayMongoService::sessionIsPaid($session)) {
                return ['paid' => true, 'reference' => (string) $txn->gateway_reference];
            }

            PayMongoService::expireCheckoutSession((string) $txn->gateway_reference);
            $txn->update(['status' => data_get($session, 'attributes.status') === 'expired' ? 'expired' : 'cancelled']);
        }

        return [];
    }

    /** The payment was already received at PayMongo: activate it now and send the Dean to the receipt. */
    private function alreadyPaid(School $school, SchoolSubscription $subscription, string $reference, ?Request $request = null): JsonResponse
    {
        $outcome = PaymentActivation::activate($subscription, $reference);
        if ($outcome['result'] === PaymentActivation::ACTIVATED) {
            PaymentActivation::announceOnlinePayment($school, $outcome['subscription'], 'already paid at PayMongo', $request);
        }

        return response()->json([
            'success'      => true,
            'method'       => $subscription->payment_method,
            'paid'         => true,
            'checkout_url' => config('app.frontend_url') . '/dean/billing?paid=1',
            'message'      => 'We already received this payment.',
        ]);
    }

    public function checkout(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        $data = $request->validate([
            'payment_method' => 'required|string|in:gcash,maya,card,bank_transfer',
        ]);

        return DB::transaction(function () use ($request, $school, $data) {
            $subscription = $this->lockedSubscription($school);

            // Payable: a fresh accepted offer, or a payment already started but not yet
            // under review (the Dean may still change the method).
            if ($subscription && $subscription->status === 'pending_payment' && $subscription->payment_status === 'pending_verification') {
                return response()->json(['success' => false, 'message' => 'Your proof of payment is already under review. Please wait for the Super Admin.'], 422);
            }

            if (!$subscription || !in_array($subscription->status, ['accepted', 'pending_payment'], true)) {
                return response()->json(['success' => false, 'message' => 'Please accept the subscription offer first.'], 422);
            }

            if ($expired = $this->rejectIfExpired($subscription, $school)) {
                return $expired;
            }

            if ((float) $subscription->amount <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Nothing to pay for this plan. The Super Admin will activate it for you.',
                ], 422);
            }

            $last = PaymentTransaction::where('subscription_id', $subscription->id)->latest('id')->first();
            $renewal = $school->subscriptions()->where('id', '<', $subscription->id)->where('status', 'expired')->exists();
            $paymentType = $last?->payment_type ?? ($renewal ? 'renewal' : 'initial');
            $previousPlanId = $last?->previous_plan_id;

            if ($data['payment_method'] === 'bank_transfer') {
                // Choosing bank transfer again (double click, page reload) shows the same reference.
                $existing = PaymentTransaction::where('subscription_id', $subscription->id)
                    ->where('status', 'pending')
                    ->where('payment_method', 'bank_transfer')
                    ->latest('id')
                    ->first();

                if ($existing && $subscription->status === 'pending_payment' && $subscription->payment_method === 'bank_transfer') {
                    return response()->json([
                        'success'      => true,
                        'method'       => 'bank_transfer',
                        'bank_details' => self::BANK_DETAILS,
                        'reference'    => $existing->gateway_reference,
                        'amount'       => $subscription->amount,
                        'message'      => 'Transfer the amount, then upload your proof of payment.',
                    ]);
                }

                $closed = $this->closeOnlineSessions($subscription);
                if (isset($closed['error'])) {
                    return $closed['error'];
                }
                if (!empty($closed['paid'])) {
                    return $this->alreadyPaid($school, $subscription, $closed['reference'], $request);
                }

                $reference = 'INTERNOVA-' . strtoupper(Str::random(8));

                $subscription->update([
                    'payment_method'    => 'bank_transfer',
                    'status'            => 'pending_payment',
                    'payment_status'    => 'pending',
                    'payment_reference' => $reference,
                ]);
                $school->update(['status' => 'pending_payment']);

                PaymentTransaction::create([
                    'school_id'         => $school->id,
                    'subscription_id'   => $subscription->id,
                    'payment_type'      => $paymentType,
                    'previous_plan_id'  => $previousPlanId,
                    'new_plan_id'       => $subscription->plan_id,
                    'payment_method'    => 'bank_transfer',
                    'amount'            => $subscription->amount,
                    'status'            => 'pending',
                    'gateway_reference' => $reference,
                ]);

                return response()->json([
                    'success'       => true,
                    'method'        => 'bank_transfer',
                    'bank_details'  => self::BANK_DETAILS,
                    'reference'     => $reference,
                    'amount'        => $subscription->amount,
                    'message'       => 'Transfer the amount, then upload your proof of payment.',
                ]);
            }

            // GCash / Maya / Card: a real PayMongo Checkout Session - the Dean is sent to
            // PayMongo's hosted page to pay. Coming back, verifyCheckout() (and the signed
            // webhook, whichever arrives first) re-confirm the payment with PayMongo before
            // anything is activated. A second click reuses the same open session.
            $breakdown = SubscriptionBreakdown::forSubscription($subscription);
            $session = $this->openOnlineSession(
                $school,
                $subscription,
                $data['payment_method'],
                (float) $breakdown['total'],
                $paymentType,
                $previousPlanId,
                "SUB-{$subscription->id}",
                $breakdown
            );

            if (isset($session['error'])) {
                return $session['error'];
            }
            if (!empty($session['paid'])) {
                return $this->alreadyPaid($school, $subscription, $session['reference'], $request);
            }

            return response()->json([
                'success'      => true,
                'method'       => $data['payment_method'],
                'checkout_url' => $session['url'],
                'message'      => 'Redirecting to PayMongo to complete payment…',
            ]);
        });
    }

    /**
     * Called when the Dean returns from PayMongo's hosted checkout page (and by
     * the "I already paid" button). Never trusts the redirect itself: it reads
     * the session straight from PayMongo and checks it is paid for the amount we
     * asked for, then hands over to the same PaymentActivation the webhook uses.
     */
    public function verifyCheckout(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

        if (!$subscription || !$subscription->payment_reference || !str_starts_with($subscription->payment_reference, 'cs_')) {
            return response()->json(['success' => false, 'message' => 'No PayMongo checkout in progress for this school.'], 422);
        }

        if ($subscription->status === 'active' && !$subscription->isRenewalExpired()) {
            return response()->json([
                'success'     => true,
                'already_active' => true,
                'valid_until' => $subscription->end_date?->format('F d, Y'),
            ]);
        }

        $reference = $subscription->payment_reference;
        $session = PayMongoService::retrieveCheckoutSession($reference);

        if (!$session) {
            return response()->json(['success' => false, 'message' => 'Could not verify payment with PayMongo.'], 502);
        }

        if (!PayMongoService::sessionIsPaid($session)) {
            return response()->json([
                'success' => false,
                'message' => 'Payment has not been completed yet.',
                'status'  => data_get($session, 'attributes.payment_intent.attributes.status'),
            ], 422);
        }

        $txn = PaymentTransaction::where('subscription_id', $subscription->id)->where('gateway_reference', $reference)->first();
        if (!PayMongoService::paidAmountMatches($session, (float) ($txn?->amount ?? $subscription->amount))) {
            Log::warning("PayMongo session {$reference} was paid for a different amount than expected; not activating.");
            NotificationService::toSuperadmin(
                'payment_mismatch',
                'Payment amount mismatch',
                "{$school->school_name} paid a PayMongo checkout for a different amount than the invoice. Review before activating.",
                '/superadmin/schools?highlight=' . $school->id
            );

            return response()->json(['success' => false, 'message' => 'The amount paid does not match this invoice. The Super Admin has been notified.'], 422);
        }

        $outcome = PaymentActivation::activate($subscription, $reference);

        if ($outcome['result'] === PaymentActivation::NOT_PAYABLE) {
            return response()->json(['success' => false, 'message' => 'This payment no longer matches an open subscription. Please contact the Super Admin.'], 422);
        }

        if ($outcome['result'] === PaymentActivation::ALREADY_ACTIVE) {
            return response()->json([
                'success'        => true,
                'already_active' => true,
                'valid_until'    => $outcome['subscription']->end_date?->format('F d, Y'),
            ]);
        }

        PaymentActivation::announceOnlinePayment($school, $outcome['subscription'], 'return from PayMongo', $request);

        return response()->json([
            'success'     => true,
            'valid_until' => $outcome['subscription']->end_date?->format('F d, Y'),
            'message'     => 'Payment confirmed. Subscription is now active.',
        ]);
    }

    /**
     * Self-service switch to a cheaper plan or shorter period (new price is not
     * higher than what is already being paid). The school has already paid for
     * its current term, so the switch is SCHEDULED for the day after that term
     * ends and billed then (see SubscriptionRollover) instead of replacing the
     * paid term. An upgrade must go through requestUpgrade(), which collects
     * payment now. A custom rate goes through requestPlanChange().
     */
    public function switchPlan(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        // Locked: two quick clicks must leave one scheduled row, not a cancel/create race.
        return DB::transaction(function () use ($request, $school) {
            School::whereKey($school->id)->lockForUpdate()->first();

            return $this->scheduleSwitchRequest($request, $school);
        });
    }

    private function scheduleSwitchRequest(Request $request, School $school): JsonResponse
    {
        $subscription = $school->currentSubscription();

        if ($school->is_suspended) {
            return response()->json(['success' => false, 'message' => 'This account is suspended. Contact the Super Admin.'], 422);
        }

        if (!$subscription || $subscription->status !== 'active') {
            return response()->json(['success' => false, 'message' => 'No active subscription to switch from.'], 422);
        }

        $data = $request->validate([
            'plan_name'      => 'required|string|in:Basic,Premium',
            'billing_period' => 'required|string|in:monthly,yearly',
        ]);

        if ($subscription->plan?->name === $data['plan_name'] && $subscription->billing_period === $data['billing_period']) {
            return response()->json(['success' => false, 'message' => 'You are already on this plan.'], 422);
        }

        $plan = SubscriptionPlan::activeOrFail($data['plan_name']);
        $price = $plan->priceFor($data['billing_period']);

        if ($price > (float) $subscription->amount) {
            return response()->json(['success' => false, 'message' => 'That is an upgrade — it requires payment. Use the Upgrade option instead.'], 422);
        }

        $scheduled = $this->scheduleSwitch($school, $subscription, $plan, $data['billing_period'], $price, 0, null);

        NotificationService::toSuperadmin(
            'plan_switch_scheduled',
            'Plan switch scheduled',
            "{$school->school_name} will switch to {$data['plan_name']} ({$data['billing_period']}) on {$scheduled->start_date->format('F d, Y')}.",
            '/superadmin/schools?highlight=' . $school->id,
            important: false
        );
        ActivityLogService::record(
            module: 'Subscription',
            action: 'Scheduled plan switch',
            description: "{$school->school_name} scheduled a switch to {$data['plan_name']} ({$data['billing_period']}) starting {$scheduled->start_date->format('F d, Y')}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success'         => true,
            'scheduled'       => true,
            'message'         => "Your switch to {$data['plan_name']} {$data['billing_period']} starts on {$scheduled->start_date->format('F d, Y')}. You keep your current plan until then.",
            'plan'            => $data['plan_name'],
            'amount'          => $scheduled->amount,
            'starts_on'       => $scheduled->start_date->format('F d, Y'),
            'scheduled_switch' => SubscriptionRollover::summary($scheduled),
        ]);
    }

    /**
     * Creates the scheduled row (replacing any earlier scheduled switch) that
     * starts the day after the paid term ends. Not billed until then.
     */
    public static function scheduleSwitch(School $school, $current, SubscriptionPlan $plan, string $period, float $listPrice, float $discount, ?string $note)
    {
        $school->subscriptions()->where('status', 'scheduled')->update(['status' => 'cancelled']);

        $start = $current->end_date->copy()->addDay();
        $end = $period === 'monthly' ? $start->copy()->addMonth() : $start->copy()->addYear();

        return $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'scheduled',
            'list_price'      => $listPrice,
            'discount_amount' => $discount,
            'amount'          => max(0, $listPrice - $discount),
            'agreement_note'  => $note,
            'billing_period'  => $period,
            'payment_method'  => $current->payment_method,
            'payment_status'  => null,
            'start_date'      => $start->toDateString(),
            'end_date'        => $end->toDateString(),
            'offer_sent_at'   => now(),
            'accepted_at'     => now(),
        ]);
    }

    public function cancelScheduledSwitch(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $scheduled = SubscriptionRollover::scheduledFor($school);

        if (!$scheduled) {
            return response()->json(['success' => true, 'message' => 'No scheduled switch to cancel.']);
        }

        $scheduled->update(['status' => 'cancelled']);

        ActivityLogService::record(
            module: 'Subscription',
            action: 'Cancelled scheduled plan switch',
            description: "{$school->school_name} cancelled its scheduled plan switch.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Scheduled switch cancelled. You stay on your current plan.']);
    }

    /**
     * Upgrade to a higher-priced plan — unlike switchPlan(), this collects real
     * payment first. A new pending_payment subscription row is created (the
     * coordinator keeps their current active plan in the meantime — see
     * School::currentSubscription()/pendingUpgrade()) and only becomes active
     * once verifyCheckout() or a Super Admin bank-transfer verification confirms
     * the payment, exactly like the initial subscription flow.
     */
    public function requestUpgrade(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        // Locked for the whole request: two simultaneous clicks must not both pass the
        // "no upgrade in progress" guard and open two payments.
        return DB::transaction(function () use ($request, $school) {
            School::whereKey($school->id)->lockForUpdate()->first();

            return $this->startUpgrade($request, $school);
        });
    }

    private function startUpgrade(Request $request, School $school): JsonResponse
    {
        // Not latestSubscription() — that would return a just-created pending upgrade
        // row on a second attempt instead of the plan actually being upgraded from.
        $current = $school->currentSubscription();

        if ($school->is_suspended) {
            return response()->json(['success' => false, 'message' => 'This account is suspended. Contact the Super Admin.'], 422);
        }

        if (!$current || $current->status !== 'active') {
            return response()->json(['success' => false, 'message' => 'No active subscription to upgrade from.'], 422);
        }

        if ($school->pendingUpgrade()) {
            return response()->json(['success' => false, 'message' => 'You already have an upgrade payment in progress.'], 422);
        }

        if ($school->approvedChange()) {
            return response()->json(['success' => false, 'message' => 'You have an approved plan change waiting for payment. Pay for it or cancel it first.'], 422);
        }

        if (SubscriptionRollover::scheduledFor($school)) {
            return response()->json(['success' => false, 'message' => 'You have a plan switch scheduled for the end of your current term. Cancel it first if you want to upgrade now.'], 422);
        }

        $data = $request->validate([
            'plan_name'      => 'required|string|in:Basic,Premium',
            'billing_period' => 'required|string|in:monthly,yearly',
            'payment_method' => 'required|string|in:gcash,maya,card,bank_transfer',
        ]);

        $periodUpgrade = $this->isPeriodUpgrade($current, $data);

        if (!$periodUpgrade && $data['billing_period'] !== $current->billing_period) {
            return response()->json(['success' => false, 'message' => 'An upgrade keeps your current billing period.'], 422);
        }

        $plan = SubscriptionPlan::activeOrFail($data['plan_name']);
        $price = $plan->priceFor($data['billing_period']);

        if (!$periodUpgrade && $price <= (float) $current->amount) {
            return response()->json(['success' => false, 'message' => 'That is not an upgrade — use the Switch Plan option instead.'], 422);
        }

        // Monthly -> yearly on the same plan: a new 12-month term (dates are set when the
        // payment is confirmed) at the yearly price less credit for the unused monthly days.
        // The stored row carries the numbers so every screen shows the same breakdown.
        $breakdown = $periodUpgrade
            ? SubscriptionBreakdown::forPeriodUpgrade($current, $plan)
            : SubscriptionBreakdown::forUpgrade($current, $plan, $data['billing_period']);

        if ($periodUpgrade && $breakdown['total'] <= 0) {
            return response()->json(['success' => false, 'message' => 'Nothing to pay for this change. Contact the Super Admin.'], 422);
        }

        // Same formula as upgradeQuote() — the coordinator is charged this exact
        // amount, not the quote they saw, in case time passed between the two calls.
        $amountNow = $breakdown['total'];

        // The cycle itself doesn't change for a plan upgrade — same start/end date as the
        // plan being upgraded from, so activate() won't recompute a fresh period for it.
        // A period upgrade has no dates yet: activate() starts the yearly term on payment.
        $pending = $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'pending_payment',
            'list_price'      => $price,
            'discount_amount' => $periodUpgrade ? $breakdown['credit'] : 0,
            'amount'          => $periodUpgrade ? $amountNow : $price,
            'agreement_note'  => $periodUpgrade ? $breakdown['agreement_note'] : null,
            'billing_period'  => $data['billing_period'],
            'payment_method'  => $data['payment_method'],
            'payment_status'  => 'pending',
            'start_date'      => $periodUpgrade ? null : $current->start_date,
            'end_date'        => $periodUpgrade ? null : $current->end_date,
        ]);

        if ($data['payment_method'] === 'bank_transfer') {
            $reference = 'INTERNOVA-' . strtoupper(Str::random(8));
            $pending->update(['payment_reference' => $reference]);

            PaymentTransaction::create([
                'school_id'         => $school->id,
                'subscription_id'   => $pending->id,
                'payment_type'      => 'upgrade',
                'previous_plan_id'  => $current->plan_id,
                'new_plan_id'       => $plan->id,
                'payment_method'    => 'bank_transfer',
                'amount'            => $amountNow,
                'status'            => 'pending',
                'gateway_reference' => $reference,
            ]);

            return response()->json([
                'success'      => true,
                'method'       => 'bank_transfer',
                'bank_details' => self::BANK_DETAILS,
                'reference'    => $reference,
                'amount'       => $amountNow,
                'message'      => 'Transfer the amount, then upload your proof of payment.',
            ]);
        }

        $session = $this->openOnlineSession(
            $school,
            $pending,
            $data['payment_method'],
            (float) $amountNow,
            'upgrade',
            $current->plan_id,
            "UPG-{$pending->id}",
            $breakdown
        );

        if (isset($session['error'])) {
            $pending->delete();

            return $session['error'];
        }

        return response()->json([
            'success'      => true,
            'method'       => $data['payment_method'],
            'checkout_url' => $session['url'],
            'message'      => 'Redirecting to PayMongo to complete payment…',
        ]);
    }

    /**
     * Lets a coordinator back out of an upgrade payment that never completed —
     * e.g. they closed PayMongo's checkout tab before finishing. Without this,
     * requestUpgrade()'s "one pending upgrade at a time" guard above leaves them
     * permanently stuck: they can't retry (blocked by that guard) and can't
     * finish (the abandoned checkout session is gone). Only cancellable while
     * nothing is actually under review — a bank-transfer proof already
     * submitted needs a Super Admin decision, not a coordinator-side undo.
     */
    public function cancelPendingUpgrade(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        return DB::transaction(function () use ($request, $school) {
            School::whereKey($school->id)->lockForUpdate()->first();
            $pending = $school->pendingUpgrade() ?? $school->approvedChange();

            if (!$pending) {
                return response()->json(['success' => true, 'message' => 'No pending upgrade to cancel.']);
            }

            $pending = SchoolSubscription::whereKey($pending->id)->lockForUpdate()->first();

            if ($pending->payment_method === 'bank_transfer' && $pending->payment_status === 'pending_verification') {
                return response()->json([
                    'success' => false,
                    'message' => 'Your bank transfer proof is already submitted and under review — contact the Super Admin if you need to cancel it.',
                ], 422);
            }

            // Close the PayMongo checkout so it cannot be paid after the upgrade is cancelled -
            // unless it was paid just now, in which case the upgrade goes through instead.
            // Not strict: cancelling must still work while PayMongo is unreachable. A payment that
            // lands later is caught by the webhook and flagged for the Super Admin.
            $closed = $this->closeOnlineSessions($pending, strict: false);
            if (isset($closed['error'])) {
                return $closed['error'];
            }
            if (!empty($closed['paid'])) {
                $this->alreadyPaid($school, $pending, $closed['reference'], $request);

                return response()->json(['success' => false, 'message' => 'Your payment was already received, so the upgrade is now active and cannot be cancelled.'], 422);
            }

            $pending->update(['status' => 'cancelled']);

            PaymentTransaction::where('subscription_id', $pending->id)
                ->whereIn('status', ['pending', 'failed'])
                ->update(['status' => 'cancelled']);

            return response()->json(['success' => true, 'message' => 'Upgrade cancelled. You can start a new one anytime.']);
        });
    }

    /**
     * For plan changes that need a custom rate/terms — creates a request the
     * Super Admin reviews (see SuperadminFullController::approvePlanChange).
     */
    public function requestPlanChange(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        $data = $request->validate([
            'plan_name'      => 'required|string|in:Basic,Premium',
            'billing_period' => 'required|string|in:monthly,yearly',
            'note'           => 'nullable|string|max:500',
        ]);

        // One open request at a time: repeats only pile up work (and notifications) for the Super Admin.
        if (PlanChangeRequest::where('school_id', $school->id)->where('status', 'pending')->exists()) {
            return response()->json(['success' => false, 'message' => 'You already have a plan change request waiting for the Super Admin. They will follow up with you.'], 422);
        }

        PlanChangeRequest::create([
            'school_id'                => $school->id,
            'requested_plan'           => $data['plan_name'],
            'requested_billing_period' => $data['billing_period'],
            'note'                     => $data['note'] ?? null,
            'status'                   => 'pending',
        ]);

        NotificationService::toSuperadmin(
            'plan_change_request',
            'Plan change requested',
            "{$school->school_name} wants to switch to {$data['plan_name']} ({$data['billing_period']}) at a custom rate.",
            '/superadmin/billing'
        );

        ActivityLogService::record(
            module: 'Subscription',
            action: 'Requested plan change',
            description: "{$school->school_name} requested {$data['plan_name']} ({$data['billing_period']}) at a custom rate.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => 'Your request has been sent to the Super Admin for review.',
        ]);
    }

    /**
     * Renewal of a subscription whose paid term ended. Without this an expired school
     * had no way forward (accept-offer and checkout both need an offer that no longer
     * exists). Renewing never charges anything by itself: it persists the expiry and
     * leaves exactly one payable row behind, so the normal checkout / bank transfer /
     * verify flow takes over:
     *  - an approved plan change or upgrade already waiting -> that row is what gets paid;
     *  - otherwise a new accepted row for the chosen plan and period (default: same as
     *    before; the same plan and period keeps the rate of the last term, a different
     *    plan or period uses the published price).
     */
    public function renew(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        $data = $request->validate([
            'plan_name'      => 'nullable|string|in:Basic,Premium',
            'billing_period' => 'nullable|string|in:monthly,yearly',
        ]);

        return DB::transaction(function () use ($request, $school, $data) {
            School::whereKey($school->id)->lockForUpdate()->first();

            if ($school->is_suspended) {
                return response()->json(['success' => false, 'message' => 'This account is suspended. Contact the Super Admin.'], 422);
            }

            $old = $school->currentSubscription();
            $expired = $old && ($old->status === 'expired' || ($old->status === 'active' && $old->isRenewalExpired()));

            if (!$old || !$expired) {
                return response()->json(['success' => false, 'message' => 'Your subscription has not expired, so there is nothing to renew.'], 422);
            }

            $old = SchoolSubscription::whereKey($old->id)->lockForUpdate()->first();

            $waiting = $school->subscriptions()
                ->where('id', '>', $old->id)
                ->whereIn('status', ['accepted', 'pending_payment'])
                ->latest('id')
                ->first();

            if ($waiting) {
                $old->update(['status' => 'expired']);
                $school->update(['status' => $waiting->status]);

                return response()->json([
                    'success' => true,
                    'message' => 'Your approved plan is ready to pay. Choose a payment method to continue.',
                ]);
            }

            $planName = $data['plan_name'] ?? $old->plan?->name;
            $period = $data['billing_period'] ?? $old->billing_period;

            if (!$planName || !$period) {
                return response()->json(['success' => false, 'message' => 'Choose a plan and billing period to renew.'], 422);
            }

            $plan = SubscriptionPlan::activeOrFail($planName);
            $sameTerms = $old->plan_id === $plan->id && $old->billing_period === $period && !SubscriptionBreakdown::isPeriodUpgrade($old);

            if ($sameTerms) {
                $amount = (float) $old->amount;
                $listPrice = (float) ($old->list_price ?: ($amount + (float) $old->discount_amount));
                $discount = max(0, round($listPrice - $amount, 2));
                $note = $old->agreement_note;
            } else {
                $listPrice = $amount = $plan->priceFor($period);
                $discount = 0;
                $note = null;
            }

            $renewal = $school->subscriptions()->create([
                'plan_id'         => $plan->id,
                'status'          => 'accepted',
                'list_price'      => $listPrice,
                'discount_amount' => $discount,
                'amount'          => $amount,
                'agreement_note'  => $note,
                'billing_period'  => $period,
                'offer_sent_at'   => now(),
                'accepted_at'     => now(),
            ]);

            $old->update(['status' => 'expired']);
            $school->update(['status' => 'accepted']);

            NotificationService::toSuperadmin(
                'renewal_started',
                'Renewal started',
                "{$school->school_name} is renewing {$plan->name} ({$period}).",
                '/superadmin/schools?highlight=' . $school->id,
                important: false
            );
            ActivityLogService::record(
                module: 'Subscription',
                action: 'Started renewal',
                description: "{$school->school_name} started renewing {$plan->name} ({$period}).",
                schoolId: $school->id,
                request: $request
            );

            return response()->json([
                'success'         => true,
                'subscription_id' => $renewal->id,
                'message'         => 'Renewal ready. Choose a payment method to continue.',
            ]);
        });
    }

    /** The offer lapsed unpaid: asks the Super Admin (in the app, not just by email) for a new one. */
    public function requestNewOffer(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->latestBillableSubscription();

        if (!$subscription || $subscription->effectiveStatus() !== 'offer_expired') {
            return response()->json(['success' => false, 'message' => 'Your offer has not expired.'], 422);
        }

        NotificationService::toSuperadmin(
            'new_offer_requested',
            'New offer requested',
            "{$school->school_name} asked for a new subscription offer (the last one expired).",
            '/superadmin/schools?highlight=' . $school->id
        );
        ActivityLogService::record(
            module: 'Subscription',
            action: 'Requested a new offer',
            description: "{$school->school_name} asked for a new subscription offer.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'The Super Admin has been notified and will send you a new offer.']);
    }

    public function uploadProof(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

        if (!$subscription || $subscription->payment_method !== 'bank_transfer' || $subscription->status !== 'pending_payment') {
            return response()->json(['success' => false, 'message' => 'No pending bank transfer found for this school.'], 422);
        }

        // A proof is already with the Super Admin: a second upload would swap the file under their review,
        // leave the first one on disk and notify them again.
        if ($subscription->payment_status === 'pending_verification') {
            return response()->json(['success' => false, 'message' => 'Your proof of payment is already under review. Please wait for the Super Admin.'], 422);
        }

        $request->validate([
            'proof' =>'required|file|mimes:jpg,jpeg,png,pdf|max:5120',
        ]);

        $path = $request->file('proof')->store("payment_proofs/{$school->id}", 'public');

        $subscription->update([
            'proof_of_payment_path' => $path,
            'payment_status'        => 'pending_verification',
        ]);

        // Only the open bank-transfer row moves to review - never paid or cancelled history.
        PaymentTransaction::where('subscription_id', $subscription->id)
            ->whereIn('status', ['pending', 'pending_verification'])
            ->update(['status' => 'pending_verification', 'proof_path' => $path]);

        NotificationService::toSuperadmin(
            'proof_uploaded',
            'Payment proof uploaded',
            "{$school->school_name} uploaded proof of bank transfer — ready for verification.",
            '/superadmin/schools?highlight=' . $school->id
        );

        ActivityLogService::record(
            module: 'Payment',
            action: 'Uploaded payment proof',
            description: "{$school->school_name} uploaded proof of bank transfer.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => 'Proof of payment uploaded. Our team will verify it shortly.',
        ]);
    }
}
