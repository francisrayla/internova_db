<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * For billing routes that carry a school id in the URL: the caller must be
 * the Dean of THAT school (role:dean alone would let any dean act on any
 * school). Run after role:dean.
 */
class EnsureDeanOfSchool
{
    public function handle(Request $request, Closure $next): Response
    {
        $schoolId = (int) $request->route('id');

        if ($schoolId !== (int) $request->user()?->school_id) {
            return response()->json(['success' => false, 'message' => 'Forbidden.'], 403);
        }

        return $next($request);
    }
}
