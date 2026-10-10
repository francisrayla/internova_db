<?php

namespace App\Services;

use App\Models\School;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The one place that talks to PayMongo's Checkout Session API. Used by the
 * Dean's checkout/upgrade flows (create + reuse), the return-from-PayMongo
 * verification (retrieve) and the webhook (signature check).
 */
class PayMongoService
{
    public static function configured(): bool
    {
        return (bool) config('services.paymongo.secret_key');
    }

    private static function client(): PendingRequest
    {
        return Http::withBasicAuth((string) config('services.paymongo.secret_key'), '')
            ->baseUrl('https://api.paymongo.com/v1');
    }

    /** Creates a hosted Checkout Session. Returns the session `data` or null when PayMongo is unavailable. */
    public static function createCheckoutSession(School $school, string $lineItemName, float $amount, string $paymentMethod, string $referenceNumber, ?string $lineItemDescription = null): ?array
    {
        // No PayMongo key on this server means online checkout simply isn't
        // available - report it as such instead of crashing the request.
        if (!self::configured()) {
            Log::warning('PayMongo checkout attempted but PAYMONGO_SECRET_KEY is not set.');
            return null;
        }

        $paymongoMethod = $paymentMethod === 'maya' ? 'paymaya' : $paymentMethod;

        try {
            $response = self::client()->post('/checkout_sessions', [
                'data' => [
                    'attributes' => [
                        'line_items' => [[
                            'name'        => $lineItemName,
                            'description' => $lineItemDescription,
                            'amount'      => (int) round($amount * 100),
                            'currency'    => 'PHP',
                            'quantity'    => 1,
                        ]],
                        'payment_method_types' => [$paymongoMethod],
                        'success_url'          => config('app.frontend_url') . '/dean/billing?paid=1',
                        'cancel_url'           => config('app.frontend_url') . '/dean/billing',
                        'description'          => "Internova subscription - {$school->school_name}",
                        'reference_number'     => $referenceNumber,
                    ],
                ],
            ]);

            return $response->failed() ? null : $response->json('data');
        } catch (\Throwable $e) {
            Log::warning('PayMongo checkout session could not be created: ' . $e->getMessage());

            return null;
        }
    }

    /** Reads a Checkout Session straight from PayMongo. Null when it could not be read. */
    public static function retrieveCheckoutSession(string $sessionId): ?array
    {
        if (!self::configured()) {
            return null;
        }

        try {
            $response = self::client()->get("/checkout_sessions/{$sessionId}");

            return $response->failed() ? null : $response->json('data');
        } catch (\Throwable $e) {
            Log::warning('PayMongo checkout session could not be read: ' . $e->getMessage());

            return null;
        }
    }

    /** Best effort: closes an abandoned session so it can no longer be paid. Never throws. */
    public static function expireCheckoutSession(string $sessionId): void
    {
        if (!self::configured() || !str_starts_with($sessionId, 'cs_')) {
            return;
        }

        try {
            self::client()->post("/checkout_sessions/{$sessionId}/expire");
        } catch (\Throwable $e) {
            Log::warning('Could not expire PayMongo checkout session ' . $sessionId . ': ' . $e->getMessage());
        }
    }

    /** True when PayMongo reports the session as paid (succeeded intent or a paid payment). */
    public static function sessionIsPaid(array $session): bool
    {
        if (data_get($session, 'attributes.payment_intent.attributes.status') === 'succeeded') {
            return true;
        }

        foreach ((array) data_get($session, 'attributes.payments', []) as $payment) {
            if (data_get($payment, 'attributes.status') === 'paid') {
                return true;
            }
        }

        return false;
    }

    /**
     * Guards against a session that was paid for a different amount than the
     * transaction we expect. When PayMongo does not say how much was paid there
     * is nothing to compare, so that counts as a match.
     */
    public static function paidAmountMatches(array $session, float $expectedAmount): bool
    {
        $expectedCentavos = (int) round($expectedAmount * 100);
        $paidAmounts = [];

        foreach ((array) data_get($session, 'attributes.payments', []) as $payment) {
            if (data_get($payment, 'attributes.status') === 'paid' && data_get($payment, 'attributes.amount') !== null) {
                $paidAmounts[] = (int) data_get($payment, 'attributes.amount');
            }
        }

        if (!$paidAmounts) {
            $intentAmount = data_get($session, 'attributes.payment_intent.attributes.amount');
            if ($intentAmount !== null) {
                $paidAmounts[] = (int) $intentAmount;
            }
        }

        return !$paidAmounts || in_array($expectedCentavos, $paidAmounts, true);
    }

    /**
     * Verifies the `Paymongo-Signature` header: "t=<unix>,te=<test sig>,li=<live sig>",
     * where each signature is HMAC-SHA256 of "<t>.<raw body>" with the webhook
     * secret. Test-mode events carry `te`, live events carry `li`.
     */
    public static function signatureIsValid(string $header, string $rawBody, bool $liveMode): bool
    {
        $secret = (string) config('services.paymongo.webhook_secret');
        if ($secret === '' || $header === '') {
            return false;
        }

        $parts = [];
        foreach (explode(',', $header) as $piece) {
            [$key, $value] = array_pad(explode('=', trim($piece), 2), 2, '');
            $parts[$key] = $value;
        }

        $timestamp = $parts['t'] ?? '';
        $given = $liveMode ? ($parts['li'] ?? '') : ($parts['te'] ?? '');
        if ($timestamp === '' || $given === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret), $given);
    }
}
