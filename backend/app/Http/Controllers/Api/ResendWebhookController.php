<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Receives delivery events from Resend (the mail provider). A bounce marks
 * the account's email as undeliverable so the coordinator sees "Email not
 * delivered" next to that intern; a later successful delivery clears it.
 *
 * Resend signs every webhook with Svix: HMAC-SHA256 over
 * "{svix-id}.{svix-timestamp}.{raw body}" using the endpoint's signing
 * secret (whsec_…), sent in the svix-signature header as "v1,<base64>".
 */
class ResendWebhookController extends Controller
{
    private const TOLERANCE_SECONDS = 300;

    public function handle(Request $request): JsonResponse
    {
        if (!$this->hasValidSignature($request)) {
            return response()->json(['success' => false], 401);
        }

        $type = $request->input('type');
        $recipients = array_map('strtolower', (array) $request->input('data.to', []));

        if ($type === 'email.bounced' && $recipients) {
            $reason = (string) ($request->input('data.bounce.message') ?: 'The receiving mail server rejected this address.');
            User::whereIn('email', $recipients)->update([
                'email_bounced_at' => now(),
                'email_bounce_reason' => mb_substr($reason, 0, 255),
            ]);
        } elseif ($type === 'email.delivered' && $recipients) {
            User::whereIn('email', $recipients)->whereNotNull('email_bounced_at')->update([
                'email_bounced_at' => null,
                'email_bounce_reason' => null,
            ]);
        }

        return response()->json(['success' => true]);
    }

    private function hasValidSignature(Request $request): bool
    {
        $secret = (string) config('services.resend.webhook_secret');
        $id = (string) $request->header('svix-id');
        $timestamp = (string) $request->header('svix-timestamp');
        $signatures = (string) $request->header('svix-signature');

        if ($secret === '' || $id === '' || $timestamp === '' || $signatures === '') {
            Log::warning('Resend webhook rejected: missing secret or signature headers.');
            return false;
        }
        if (!ctype_digit($timestamp) || abs(time() - (int) $timestamp) > self::TOLERANCE_SECONDS) {
            return false;
        }

        $key = base64_decode(str_starts_with($secret, 'whsec_') ? substr($secret, 6) : $secret, true);
        if ($key === false) {
            return false;
        }
        $expected = base64_encode(hash_hmac('sha256', "{$id}.{$timestamp}.{$request->getContent()}", $key, true));

        foreach (explode(' ', $signatures) as $entry) {
            [$version, $signature] = array_pad(explode(',', $entry, 2), 2, '');
            if ($version === 'v1' && hash_equals($expected, $signature)) {
                return true;
            }
        }
        return false;
    }
}
