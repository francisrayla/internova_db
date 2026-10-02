<?php

namespace App\Http\Middleware;

use App\Models\Attendance;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class AutoCloseStaleAttendance
{
    // No scheduler runs in this deployment, so forgotten clock-outs are closed
    // lazily on API traffic instead — at most once a minute across all requests.
    public function handle(Request $request, Closure $next): Response
    {
        if (Cache::add('attendance:auto-close', 1, 60)) {
            Attendance::autoCloseStale();
        }

        return $next($request);
    }
}
