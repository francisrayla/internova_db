<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Services\ActivityLogService;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Self-service subscription actions for the school's primary coordinator:
 * review/accept the subscription offer, pay, and upload proof of payment.
 */
class CoordinatorSubscriptionController extends Controller
{
    /**
     * Bank details shown to schools that choose manual bank transfer.
     * Placeholder until real merchant details are configured.
     */
    private const BANK_DETAILS = [
        'bank_name'     => 'BDO Unibank',
        'account_name'  => 'Internova AI Technologies Inc.',
        'account_number'=> '0012-3456-7890',
    ];

    // Local dev only — this app has no environment-specific frontend URL config yet.
    private const FRONTEND_URL = 'http://localhost:3000';

    private function paymongo(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::withBasicAuth(config('services.paymongo.secret_key'), '')
            ->baseUrl('https://api.paymongo.com/v1');
    }

    private function latestSubscription(School $school)
    {
        return $school->subscriptions()->latest('id')->first();
    }

    /**
     * Creates a PayMongo Checkout Session (test mode) shared by the initial
     * subscription payment and plan upgrades — one place that knows how to
     * talk to PayMongo instead of duplicating the request shape twice.
     */
    private function createCheckoutSession(School $school, string $lineItemName, float $amount, string $paymentMethod, string $referenceNumber): ?array
    {
        $paymongoMethod = $paymentMethod === 'maya' ? 'paymaya' : $paymentMethod;

        $response = $this->paymongo()->post('/checkout_sessions', [
            'data' => [
                'attributes' => [
                    'line_items' => [[
                        'name'     => $lineItemName,
                        'amount'   => (int) round($amount * 100),
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ]],
                    'payment_method_types' => [$paymongoMethod],
                    'success_url'          => self::FRONTEND_URL . '/coordinator/subscription?paid=1',
                    'cancel_url'           => self::FRONTEND_URL . '/coordinator/subscription',
                    'description'          => "Internova AI subscription — {$school->school_name}",
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
        $oldPrice = SubscriptionPlan::priceForName($current->plan?->name, $current->billing_period);
        $difference = $newPrice - $oldPrice;

        $totalDays = max(1, $current->start_date->diffInDays($current->end_date));
        $remainingDays = min($totalDays, max(0, now()->startOfDay()->diffInDays($current->end_date->copy()->startOfDay())));

        $amountNow = round($difference * $remainingDays / $totalDays, 2);

        return [
            'old_price'          => $oldPrice,
            'new_price'          => $newPrice,
            'difference'         => $difference,
            'total_days'         => $totalDays,
            'remaining_days'     => $remainingDays,
            'amount_now'         => max(0, $amountNow),
            'next_renewal_price' => $newPrice,
            'current_end_date'   => $current->end_date->format('F d, Y'),
        ];
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

        $newPrice = SubscriptionPlan::activeOrFail($data['plan_name'])->priceFor($data['billing_period']);

        if ($newPrice <= (float) $current->amount) {
            return response()->json(['success' => false, 'message' => 'That is not an upgrade — use the Switch Plan option instead.'], 422);
        }

        return response()->json(['success' => true, 'quote' => $this->calculateProration($current, $newPrice)]);
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
        $planName = $subscription->plan?->name ?? 'Subscription';
        $checkoutSession = $this->createCheckoutSession(
            $school,
            "{$planName} Plan ({$subscription->billing_period})",
            (float) $subscription->amount,
            $data['payment_method'],
            "SUB-{$subscription->id}"
        );

        if (!$checkoutSession) {
            return response()->json([
                'success' => false,
                'message' => 'Could not start checkout with PayMongo. Please try again.',
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
     * Instant self-service switch — only for a downgrade or lateral move (new price
     * is not higher than what's already being paid), so no new money needs to be
     * collected. An upgrade must go through requestUpgrade() instead, which requires
     * actual payment before the higher-tier plan takes effect. A custom rate for
     * either direction goes through requestPlanChange() for Super Admin review.
     */
    public function switchPlan(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $this->latestSubscription($school);

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

        $end = $data['billing_period'] === 'monthly' ? now()->addMonth() : now()->addYear();

        $new = $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'active',
            'list_price'      => $price,
            'discount_amount' => 0,
            'amount'          => $price,
            'billing_period'  => $data['billing_period'],
            'payment_method'  => $subscription->payment_method,
            'payment_status'  => 'paid',
            'paid_at'         => now(),
            'start_date'      => now()->toDateString(),
            'end_date'        => $end->toDateString(),
            'offer_sent_at'   => now(),
            'accepted_at'     => now(),
        ]);

        $this->supersedeOtherActive($school, $new);

        return response()->json([
            'success'     => true,
            'message'     => "Switched to the {$data['plan_name']} plan.",
            'plan'        => $data['plan_name'],
            'amount'      => $new->amount,
            'valid_until' => $new->end_date->format('F d, Y'),
        ]);
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
        $proration = $this->calculateProration($current, $price);
        $amountNow = $proration['amount_now'];

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
            "Upgrade to {$data['plan_name']} ({$data['billing_period']}) — prorated",
            (float) $amountNow,
            $data['payment_method'],
            "UPG-{$pending->id}"
        );

        if (!$checkoutSession) {
            $pending->delete();

            return response()->json([
                'success' => false,
                'message' => 'Could not start checkout with PayMongo. Please try again.',
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
