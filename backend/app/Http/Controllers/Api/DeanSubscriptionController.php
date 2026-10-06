<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Services\ActivityLogService;
use App\Services\NotificationService;
use App\Services\SubscriptionBreakdown;
use App\Services\SubscriptionRollover;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
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

    private function paymongo(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::withBasicAuth((string) config('services.paymongo.secret_key'), '')
            ->baseUrl('https://api.paymongo.com/v1');
    }

    private function latestSubscription(School $school)
    {
        return $school->latestBillableSubscription();
    }

    /**
     * Creates a PayMongo Checkout Session (test mode) shared by the initial
     * subscription payment and plan upgrades — one place that knows how to
     * talk to PayMongo instead of duplicating the request shape twice.
     */
    private function createCheckoutSession(School $school, string $lineItemName, float $amount, string $paymentMethod, string $referenceNumber, ?string $lineItemDescription = null): ?array
    {
        // No PayMongo key on this server means online checkout simply isn't
        // available — report it as such instead of crashing the request.
        if (!config('services.paymongo.secret_key')) {
            Log::warning('PayMongo checkout attempted but PAYMONGO_SECRET_KEY is not set.');
            return null;
        }

        $paymongoMethod = $paymentMethod === 'maya' ? 'paymaya' : $paymentMethod;

        $response = $this->paymongo()->post('/checkout_sessions', [
            'data' => [
                'attributes' => [
                    'line_items' => [[
                        'name'     => $lineItemName,
                        'description' => $lineItemDescription,
                        'amount'   => (int) round($amount * 100),
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ]],
                    'payment_method_types' => [$paymongoMethod],
                    'success_url'          => config('app.frontend_url') . '/dean/billing?paid=1',
                    'cancel_url'           => config('app.frontend_url') . '/dean/billing',
                    'description'          => "Internova subscription — {$school->school_name}",
                    'reference_number'     => $referenceNumber,
                ],
            ],
        ]);

        return $response->failed() ? null : $response->json('data');
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

    /**
     * Marking any other active row for this school as superseded once a new one
     * takes over — a subscription upgrade or downgrade replaces the plan that
     * governs access, so only one row should ever read as "active" at a time.
     */
    private function supersedeOtherActive(School $school, $newlyActive): void
    {
        $school->subscriptions()
            ->where('status', 'active')
            ->where('id', '!=', $newlyActive->id)
            ->update(['status' => 'superseded']);
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
        $subscription = $this->latestSubscription($school);

        if (!$subscription || $subscription->status !== 'awaiting_acceptance') {
            return response()->json(['success' => false, 'message' => 'No subscription offer is awaiting your acceptance.'], 422);
        }

        if ($expired = $this->rejectIfExpired($subscription, $school)) {
            return $expired;
        }

        $subscription->update(['status' => 'accepted', 'accepted_at' => now()]);
        $school->update(['status' => 'accepted']);

        return response()->json(['success' => true, 'message' => 'Offer accepted. Choose a payment method to continue.']);
    }

    public function checkout(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

        if (!$subscription || $subscription->status !== 'accepted') {
            return response()->json(['success' => false, 'message' => 'Please accept the subscription offer first.'], 422);
        }

        if ($expired = $this->rejectIfExpired($subscription, $school)) {
            return $expired;
        }

        $data = $request->validate([
            'payment_method' => 'required|string|in:gcash,maya,card,bank_transfer',
        ]);

        if ($data['payment_method'] === 'bank_transfer') {
            $reference = 'INTERNOVA-' . strtoupper(Str::random(8));

            $subscription->update([
                'payment_method'    => 'bank_transfer',
                'status'            => 'pending_payment',
                'payment_status'    => 'pending',
                'payment_reference' => $reference,
            ]);
            $school->update(['status' => 'pending_payment']);

            PaymentTransaction::create([
                'school_id'        => $school->id,
                'subscription_id'  => $subscription->id,
                'payment_type'     => 'initial',
                'new_plan_id'      => $subscription->plan_id,
                'payment_method'   => 'bank_transfer',
                'amount'           => $subscription->amount,
                'status'           => 'pending',
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

        // GCash / Maya / Card: real PayMongo Checkout Session (test mode) — the
        // coordinator is redirected to PayMongo's hosted page to pay, then the
        // frontend calls verifyCheckout() when they return, which re-confirms
        // payment status directly with PayMongo before activating anything.
        $breakdown = SubscriptionBreakdown::forSubscription($subscription);
        $checkoutSession = $this->createCheckoutSession(
            $school,
            $breakdown['line_item_name'],
            $breakdown['total'],
            $data['payment_method'],
            "SUB-{$subscription->id}",
            $breakdown['description']
        );

        if (!$checkoutSession) {
            return response()->json([
                'success' => false,
                'message' => 'Online payment is unavailable right now. Please try again later or choose Bank Transfer.',
            ], 502);
        }

        $subscription->update([
            'payment_method'    => $data['payment_method'],
            'payment_status'    => 'pending',
            'payment_reference' => $checkoutSession['id'],
        ]);

        PaymentTransaction::create([
            'school_id'        => $school->id,
            'subscription_id'  => $subscription->id,
            'payment_type'     => 'initial',
            'new_plan_id'      => $subscription->plan_id,
            'payment_method'   => $data['payment_method'],
            'amount'           => $subscription->amount,
            'status'           => 'pending',
            'gateway_reference' => $checkoutSession['id'],
        ]);

        return response()->json([
            'success'      => true,
            'method'       => $data['payment_method'],
            'checkout_url' => $checkoutSession['attributes']['checkout_url'],
            'message'      => 'Redirecting to PayMongo to complete payment…',
        ]);
    }

    /**
     * Called when the coordinator returns from PayMongo's hosted checkout page.
     * Re-confirms payment status directly with PayMongo (not just trusting the
     * redirect) before activating the subscription.
     */
    public function verifyCheckout(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

        if (!$subscription || !$subscription->payment_reference || !str_starts_with($subscription->payment_reference, 'cs_')) {
            return response()->json(['success' => false, 'message' => 'No PayMongo checkout in progress for this school.'], 422);
        }

        if ($subscription->status === 'active') {
            return response()->json([
                'success'     => true,
                'already_active' => true,
                'valid_until' => $subscription->end_date?->format('F d, Y'),
            ]);
        }

        $response = $this->paymongo()->get("/checkout_sessions/{$subscription->payment_reference}");

        if ($response->failed()) {
            return response()->json(['success' => false, 'message' => 'Could not verify payment with PayMongo.'], 502);
        }

        $paymentIntentStatus = $response->json('data.attributes.payment_intent.attributes.status');

        if ($paymentIntentStatus !== 'succeeded') {
            return response()->json([
                'success' => false,
                'message' => 'Payment has not been completed yet.',
                'status'  => $paymentIntentStatus,
            ], 422);
        }

        $subscription->activate();
        $school->update(['status' => 'active']);
        $this->supersedeOtherActive($school, $subscription);

        PaymentTransaction::where('subscription_id', $subscription->id)
            ->update(['status' => 'paid', 'paid_at' => now()]);

        NotificationService::toSuperadmin(
            'payment_confirmed',
            'Payment confirmed',
            "{$school->school_name} paid via {$subscription->payment_method} and is now active.",
            '/superadmin/schools?highlight=' . $school->id
        );

        ActivityLogService::record(
            module: 'Payment',
            action: 'Paid via ' . $subscription->payment_method,
            description: "{$school->school_name}'s subscription is now active.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success'     => true,
            'valid_until' => $subscription->fresh()->end_date?->format('F d, Y'),
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

        if (SubscriptionRollover::scheduledFor($school)) {
            return response()->json(['success' => false, 'message' => 'You have a plan switch scheduled for the end of your current term. Cancel it first if you want to upgrade now.'], 422);
        }

        $data = $request->validate([
            'plan_name'      => 'required|string|in:Basic,Premium',
            'billing_period' => 'required|string|in:monthly,yearly',
            'payment_method' => 'required|string|in:gcash,maya,card,bank_transfer',
        ]);

        if ($data['billing_period'] !== $current->billing_period) {
            return response()->json(['success' => false, 'message' => 'An upgrade keeps your current billing period.'], 422);
        }

        $plan = SubscriptionPlan::activeOrFail($data['plan_name']);
        $price = $plan->priceFor($data['billing_period']);

        if ($price <= (float) $current->amount) {
            return response()->json(['success' => false, 'message' => 'That is not an upgrade — use the Switch Plan option instead.'], 422);
        }

        // Same formula as upgradeQuote() — the coordinator is charged this exact
        // amount, not the quote they saw, in case time passed between the two calls.
        $breakdown = SubscriptionBreakdown::forUpgrade($current, $plan, $data['billing_period']);
        $amountNow = $breakdown['total'];

        // The cycle itself doesn't change — same start/end date as the plan being
        // upgraded from, so activate() won't recompute a fresh period for it.
        $pending = $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'pending_payment',
            'list_price'      => $price,
            'discount_amount' => 0,
            'amount'          => $price,
            'billing_period'  => $data['billing_period'],
            'payment_method'  => $data['payment_method'],
            'payment_status'  => 'pending',
            'start_date'      => $current->start_date,
            'end_date'        => $current->end_date,
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

        $checkoutSession = $this->createCheckoutSession(
            $school,
            $breakdown['line_item_name'],
            (float) $amountNow,
            $data['payment_method'],
            "UPG-{$pending->id}",
            $breakdown['description']
        );

        if (!$checkoutSession) {
            $pending->delete();

            return response()->json([
                'success' => false,
                'message' => 'Online payment is unavailable right now. Please try again later or choose Bank Transfer.',
            ], 502);
        }

        $pending->update(['payment_reference' => $checkoutSession['id']]);

        PaymentTransaction::create([
            'school_id'         => $school->id,
            'subscription_id'   => $pending->id,
            'payment_type'      => 'upgrade',
            'previous_plan_id'  => $current->plan_id,
            'new_plan_id'       => $plan->id,
            'payment_method'    => $data['payment_method'],
            'amount'            => $amountNow,
            'status'            => 'pending',
            'gateway_reference' => $checkoutSession['id'],
        ]);

        return response()->json([
            'success'      => true,
            'method'       => $data['payment_method'],
            'checkout_url' => $checkoutSession['attributes']['checkout_url'],
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
    public function cancelPendingUpgrade(int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $pending = $school->pendingUpgrade();

        if (!$pending) {
            return response()->json(['success' => true, 'message' => 'No pending upgrade to cancel.']);
        }

        if ($pending->payment_method === 'bank_transfer' && $pending->payment_status === 'pending_verification') {
            return response()->json([
                'success' => false,
                'message' => 'Your bank transfer proof is already submitted and under review — contact the Super Admin if you need to cancel it.',
            ], 422);
        }

        $pending->update(['status' => 'cancelled']);

        PaymentTransaction::where('subscription_id', $pending->id)
            ->where('status', 'pending')
            ->update(['status' => 'cancelled']);

        return response()->json(['success' => true, 'message' => 'Upgrade cancelled. You can start a new one anytime.']);
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

    public function uploadProof(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

        if (!$subscription || $subscription->payment_method !== 'bank_transfer' || $subscription->status !== 'pending_payment') {
            return response()->json(['success' => false, 'message' => 'No pending bank transfer found for this school.'], 422);
        }

        $request->validate([
            'proof' => 'required|file|mimes:jpg,jpeg,png,pdf|max:5120',
        ]);

        $path = $request->file('proof')->store("payment_proofs/{$school->id}", 'public');

        $subscription->update([
            'proof_of_payment_path' => $path,
            'payment_status'        => 'pending_verification',
        ]);

        PaymentTransaction::where('subscription_id', $subscription->id)
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
