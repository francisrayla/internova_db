<?php

namespace App\Support;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * The named rate limiters behind the `throttle:<name>` middleware on every
 * unauthenticated POST (login, password reset, email verification, invitations,
 * the public inquiry form) and the general API ceiling. Registered once from
 * AppServiceProvider::boot().
 *
 * Every limiter keys on the e-mail address as well as on the visitor's IP:
 * - e-mail + IP is the gentle limit (a person fumbling their own password),
 * - e-mail alone is the hard cap that still holds when an attacker rotates IPs,
 * - IP alone stops one machine from flooding the endpoint with random e-mails.
 *
 * The browser never calls Laravel directly: the Next.js server proxies every
 * request, so $request->ip() is the Next server. The proxy therefore forwards the
 * visitor's address in X-Client-IP (see frontend serverProxy.js) and clientIp()
 * prefers it. A direct caller could spoof that header, which is why the IP-only
 * ceilings are generous and the e-mail-only caps carry the real protection.
 */
class RateLimits
{
    public static function register(): void
    {
        // Sign-in: a few tries a minute per person, 20 per 10 minutes per e-mail overall.
        RateLimiter::for('auth-login', fn (Request $r) => [
            self::limit(Limit::perMinute(6), 'login-pair:'.self::email($r).'|'.self::clientIp($r), 'Too many sign-in attempts.'),
            self::limit(Limit::perMinutes(10, 20), 'login-email:'.self::email($r), 'Too many sign-in attempts for this account.'),
            self::limit(Limit::perMinute(120), 'login-ip:'.self::clientIp($r), 'Too many sign-in attempts from this network.'),
        ]);

        // 6-digit codes (verify e-mail, verify reset code, reset password): 30 guesses per 15 minutes
        // per e-mail is ~0.003% against a code that also expires after 15 minutes.
        RateLimiter::for('auth-code', fn (Request $r) => [
            self::limit(Limit::perMinute(10), 'code-pair:'.self::email($r).'|'.self::clientIp($r), 'Too many attempts.'),
            self::limit(Limit::perMinutes(15, 30), 'code-email:'.self::email($r), 'Too many attempts for this account.'),
            self::limit(Limit::perMinute(120), 'code-ip:'.self::clientIp($r), 'Too many attempts from this network.'),
        ]);

        // Anything that sends an e-mail (forgot password, resend code): stops mail bombing a mailbox.
        RateLimiter::for('auth-mail', fn (Request $r) => [
            self::limit(Limit::perMinute(5), 'mail-pair:'.self::email($r).'|'.self::clientIp($r), 'Too many requests.'),
            self::limit(Limit::perHour(10), 'mail-email:'.self::email($r), 'Too many e-mails were requested for this address.'),
            self::limit(Limit::perHour(200), 'mail-ip:'.self::clientIp($r), 'Too many requests from this network.'),
        ]);

        // Looking up / accepting an invitation by its one-time token.
        RateLimiter::for('invitation', fn (Request $r) => [
            self::limit(Limit::perMinute(10), 'invite-pair:'.self::clientIp($r).'|'.Str::limit((string) $r->route('token'), 16, ''), 'Too many attempts.'),
            self::limit(Limit::perMinute(60), 'invite-ip:'.self::clientIp($r), 'Too many attempts from this network.'),
        ]);

        // The public inquiry form creates an account and sends a code. This middleware only guards against raw
        // flooding (generous, counts every attempt, even rejected ones). The strict "registrations per hour"
        // limits count only registrations that actually went through: see inquiryBlocked()/inquiryRegistered(),
        // so a few typing mistakes never lock a school out.
        RateLimiter::for('inquiry', fn (Request $r) => [
            self::limit(Limit::perHour(30), 'inquiry-raw-email:'.self::email($r), 'Too many attempts were made with this e-mail address.'),
            self::limit(Limit::perHour(60), 'inquiry-raw-ip:'.self::clientIp($r), 'Too many requests were sent from this network.'),
        ]);

        // Ceiling for the whole API (the throttleApi() group middleware): generous, only stops runaway loops.
        RateLimiter::for('api', function (Request $r) {
            $user = $r->user('sanctum');

            return self::limit(
                $user ? Limit::perMinute(1500) : Limit::perMinute(600),
                $user ? 'api-user:'.$user->getAuthIdentifier() : 'api-ip:'.self::clientIp($r),
                'You are doing that too fast.'
            );
        });
    }

    /** Registrations that succeeded, per window: [key, max, window seconds, reason]. */
    private static function inquiryRules(Request $request): array
    {
        return [
            ['inquiry-ok-email:'.self::email($request), 3, 3600, 'This e-mail address has already been used to send several requests.'],
            ['inquiry-ok-ip:'.self::clientIp($request), 10, 3600, 'Too many requests were sent from this network.'],
            ['inquiry-ok-all', 100, 3600, 'We are receiving a lot of requests right now.'],
        ];
    }

    /** Call after the form validated, before creating anything: a 429 response when this visitor already registered too many times. */
    public static function inquiryBlocked(Request $request): ?\Illuminate\Http\JsonResponse
    {
        foreach (self::inquiryRules($request) as [$key, $max, $window, $reason]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return self::tooManyResponse($reason, RateLimiter::availableIn($key));
            }
        }

        return null;
    }

    /** Call once a registration really went through. */
    public static function inquiryRegistered(Request $request): void
    {
        foreach (self::inquiryRules($request) as [$key, , $window]) {
            RateLimiter::hit($key, $window);
        }
    }

    /** The visitor's address as the Next.js proxy saw it, else the connecting address. */
    public static function clientIp(Request $request): string
    {
        $forwarded = trim((string) $request->header('X-Client-IP'));
        if ($forwarded !== '' && filter_var($forwarded, FILTER_VALIDATE_IP)) {
            return $forwarded;
        }

        return (string) $request->ip();
    }

    private static function email(Request $request): string
    {
        $email = Str::lower(trim((string) $request->input('email')));

        return $email !== '' ? Str::limit($email, 190, '') : 'none';
    }

    /** One limit with the friendly JSON 429 every frontend screen can show as-is. */
    private static function limit(Limit $limit, string $key, string $reason): Limit
    {
        return $limit->by($key)->response(function (Request $request, array $headers) use ($reason) {
            return self::tooManyResponse($reason, (int) ($headers['Retry-After'] ?? 60), $headers);
        });
    }

    private static function tooManyResponse(string $reason, int $seconds, array $headers = []): \Illuminate\Http\JsonResponse
    {
        $seconds = max(1, $seconds);
        $hours = (int) ceil($seconds / 3600);
        $wait = $seconds >= 3600 ? $hours.($hours === 1 ? ' hour' : ' hours')
            : ($seconds >= 90 ? ceil($seconds / 60).' minutes' : $seconds.' seconds');

        return response()->json([
            'success'     => false,
            'code'        => 'too_many_requests',
            'message'     => "{$reason} Please wait about {$wait} and try again.",
            'retry_after' => $seconds,
        ], 429, $headers);
    }
}
