<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentTransaction;
use App\Services\NotificationService;
use App\Services\PayMongoService;
use App\Services\PaymentActivation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Receives payment events from PayMongo, so a school that paid but closed the
 * browser tab before returning to Internova is still activated. Authenticated
 * only by the Paymongo-Signature header (HMAC with PAYMONGO_WEBHOOK_SECRET).
 *
 * Idempotent by design: PayMongo retries and may deliver an event twice, and the
 * Dean's own return from checkout can race it - both end in
 * PaymentActivation::activate(), which is a no-op for an already-active row.
 *
 * Events handled: checkout_session.payment.paid and payment.paid (activate),
 * payment.failed (mark the attempt failed, tell the Dean), checkout_session.expired
 * (close the attempt). Anything else is acknowledged and ignored.
 */
class PayMongoWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        if ((string) config('services.paymongo.webhook_secret') === '') {
            Log::warning('PayMongo webhook rejected: PAYMONGO_WEBHOOK_SECRET is not set.');
            return response()->json(['success' => false, 'message' => 'Webhook not configured.'], 503);
        }

        $raw = $request->getContent();
        $payload = json_decode($raw, true);
        $liveMode = (bool) data_get($payload, 'data.attributes.livemode', false);

        if (!is_array($payload) || !PayMongoService::signatureIsValid((string) $request->header('Paymongo-Signature'), $raw, $liveMode)) {
            Log::warning('PayMongo webhook rejected: bad or missing signature.');
            return response()->json(['success' => false], 401);
        }

        $type = (string) data_get($payload, 'data.attributes.type');
        $resource = (array) data_get($payload, 'data.attributes.data', []);

        $txn = $this->findTransaction($resource);
        if (!$txn) {
            // Not one of ours (or already cleaned up): acknowledge so PayMongo stops retrying.
            return response()->json(['success' => true, 'ignored' => true]);
        }

        match ($type) {
            'checkout_session.payment.paid', 'payment.paid' => $this->paid($txn, $resource),
            'payment.failed'                                => $this->failed($txn),
            'checkout_session.expired'                      => $this->expired($txn),
            default                                         => null,
        };

        return response()->json(['success' => true]);
    }

    /** The transaction a PayMongo resource (checkout session or payment) belongs to. */
    private function findTransaction(array $resource): ?PaymentTransaction
    {
        $ids = array_filter([
            data_get($resource, 'id'),
            data_get($resource, 'attributes.checkout_session_id'),
        ], fn ($id) => is_string($id) && str_starts_with($id, 'cs_'));

        if ($ids) {
            $txn = PaymentTransaction::whereIn('gateway_reference', $ids)->latest('id')->first();
            if ($txn) {
                return $txn;
            }
        }

        // Payments carry the checkout's reference number ("SUB-12" / "UPG-12") instead.
        $reference = data_get($resource, 'attributes.reference_number') ?? data_get($resource, 'attributes.external_reference_number');
        if (is_string($reference) && preg_match('/^(?:SUB|UPG)-(\d+)$/', $reference, $m)) {
            return PaymentTransaction::where('subscription_id', (int) $m[1])
                ->where('gateway_reference', 'like', 'cs_%')
                ->latest('id')
                ->first();
        }

        return null;
    }

    private function paid(PaymentTransaction $txn, array $resource): void
    {
        $subscription = $txn->subscription;
        $school = $subscription?->school;
        if (!$subscription || !$school) {
            return;
        }

        // Defence in depth: the signed event must also describe the amount we asked for.
        $isPayment = data_get($resource, 'type') === 'payment';
        $amountOk = $isPayment && data_get($resource, 'attributes.amount') !== null
            ? (int) data_get($resource, 'attributes.amount') === (int) round((float) $txn->amount * 100)
            : PayMongoService::paidAmountMatches($resource, (float) $txn->amount);

        if (!$amountOk) {
            Log::warning("PayMongo webhook: amount mismatch for {$txn->gateway_reference}; not activating.");
            NotificationService::toSuperadmin(
                'payment_mismatch',
                'Payment amount mismatch',
                "{$school->school_name} paid a PayMongo checkout for a different amount than the invoice. Review before activating.",
                '/superadmin/schools?highlight=' . $school->id
            );
            return;
        }

        $outcome = PaymentActivation::activate($subscription, $txn->gateway_reference);

        if ($outcome['result'] === PaymentActivation::ACTIVATED) {
            PaymentActivation::announceOnlinePayment($school, $outcome['subscription'], 'webhook');
            return;
        }

        if ($outcome['result'] === PaymentActivation::NOT_PAYABLE) {
            // Money arrived for a subscription that was cancelled meanwhile: keep the record
            // of the payment and put it in front of a human instead of silently dropping it.
            $txn->update(['status' => 'paid', 'paid_at' => $txn->paid_at ?? now()]);
            NotificationService::toSuperadmin(
                'payment_needs_review',
                'Payment received for a closed subscription',
                "{$school->school_name} paid PayMongo checkout {$txn->gateway_reference} after the subscription was cancelled. Review and refund or activate manually.",
                '/superadmin/schools?highlight=' . $school->id
            );
        }
    }

    private function failed(PaymentTransaction $txn): void
    {
        if ($txn->status !== 'pending') {
            return;
        }

        $txn->update(['status' => 'failed']);

        NotificationService::toSchoolDean(
            $txn->school_id,
            'payment_failed',
            'Payment did not go through',
            'Your online payment failed. Open Billing to try again.',
            '/dean/billing'
        );
    }

    private function expired(PaymentTransaction $txn): void
    {
        if ($txn->status === 'pending') {
            $txn->update(['status' => 'expired']);
        }
    }
}
