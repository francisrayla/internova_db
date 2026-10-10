<?php

namespace App\Http\Middleware;

use App\Models\Setting;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The System Settings "Maintenance Mode" toggle's actual enforcement — every
 * request is blocked with 503 while it's on, except an already-authenticated
 * Super Admin (role_id 1, resolved from the Bearer token via the sanctum guard) and a short allowlist of routes that have to keep
 * working regardless (the health check, and login itself — login can't be
 * blocked here since the request isn't authenticated yet at middleware time;
 * AuthController::login() does the same role check once it knows who's
 * signing in, so a non-admin can't get a token while maintenance is on
 * either, and a Super Admin can always log back in to turn it off).
 */
class EnforceMaintenanceMode
{
    private const ALWAYS_ALLOWED = ['api/health', 'api/auth/login'];

    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->path(), self::ALWAYS_ALLOWED, true)) {
            return $next($request);
        }

        if (Setting::value('maintenance_mode', '0') !== '1') {
            return $next($request);
        }

        // This middleware sits in the global `api` group and the default guard is `web` (session),
        // so a plain $request->user() only works because Laravel's middleware priority happens to run
        // auth:sanctum first (and flips the default guard). Ask the sanctum guard directly instead:
        // it reads the Bearer token itself and does not depend on that ordering. The role is
        // compared by name, not by the id 1 it happens to have in production.
        if ($request->user('sanctum')?->roles?->name === 'super_admin') {
            return $next($request);
        }

        return response()->json([
            'success'     => false,
            'maintenance' => true,
            'message'     => 'Internova is currently undergoing maintenance. Please check back shortly.',
        ], 503);
    }
}
