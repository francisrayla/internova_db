<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Server-side enforcement of the school access gates the frontend layouts only
 * mirror: users of a suspended school, or of a school whose subscription is not
 * active (expired, offer expired, awaiting acceptance/payment), get a 403 with a
 * machine-readable `code` on every school-scoped endpoint.
 *
 *   school_suspended      the Super Admin suspended the school
 *   subscription_expired  the paid term (or the offer) lapsed
 *   subscription_unpaid   an offer exists but is not accepted / paid yet
 *
 * Alias `school.active`; put it on the role groups and leave the pages that must
 * stay reachable OUTSIDE it: auth (login, session, logout, profile), billing
 * (dean/schools/{id}/...), notifications, support tickets. The Super Admin and
 * accounts without a school pass. A school with no subscription row at all also
 * passes (nothing to be expired; same as before this middleware existed).
 */
class EnsureSchoolAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $denied = self::denial($request->user());

        if ($denied) {
            return response()->json([
                'success' => false,
                'code'    => $denied['code'],
                'message' => $denied['message'],
            ], 403);
        }

        return $next($request);
    }

    /** @return array{code: string, message: string}|null */
    public static function denial($user): ?array
    {
        if (!$user || !$user->school_id || $user->roles?->name === 'super_admin') {
            return null;
        }

        $school = $user->school;
        if (!$school) {
            return null;
        }

        if ($school->is_suspended) {
            return [
                'code'    => 'school_suspended',
                'message' => "{$school->school_name}'s access has been suspended. Please contact your school or the Super Admin.",
            ];
        }

        $subscription = $school->currentSubscription();
        if (!$subscription) {
            return null;
        }

        $status = $subscription->effectiveStatus();
        if ($status === 'active') {
            return null;
        }

        if (in_array($status, ['expired', 'offer_expired'], true)) {
            return [
                'code'    => 'subscription_expired',
                'message' => "{$school->school_name}'s subscription has expired. The Dean can renew it in Billing.",
            ];
        }

        return [
            'code'    => 'subscription_unpaid',
            'message' => "{$school->school_name}'s subscription is not active yet. The Dean can finish it in Billing.",
        ];
    }
}
