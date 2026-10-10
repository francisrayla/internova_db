<?php

use App\Http\Middleware\EnsureRole;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Private channels only: the browser authorizes each one at POST /api/broadcasting/auth with its
    // Sanctum bearer token (routes/channels.php decides who may listen).
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role' => EnsureRole::class,
            'school.active' => \App\Http\Middleware\EnsureSchoolAccess::class,
            'dean.school' => \App\Http\Middleware\EnsureDeanOfSchool::class,
        ]);

        // Generous ceiling for the whole API; the strict per-route limits (login, reset, ...) live in App\Support\RateLimits.
        $middleware->throttleApi();

        $middleware->appendToGroup('api', \App\Http\Middleware\AutoCloseStaleAttendance::class);
        $middleware->appendToGroup('api', \App\Http\Middleware\EnforceMaintenanceMode::class);

        // Pure JSON API, no 'login' web route to redirect a guest to — always
        // fail with a 401 response instead of Laravel's default redirect.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
