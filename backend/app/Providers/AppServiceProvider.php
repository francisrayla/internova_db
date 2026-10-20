<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        \App\Support\RateLimits::register();

        // Open task screens reload when a task, subtask, proof, comment or rating changes.
        \App\Services\TaskLiveUpdates::register();

        // Record ids in URLs are always numbers: /interns/abc is a 404, not a TypeError (HTTP 500) in the controller.
        foreach (['id', 'deploymentId', 'taskId', 'subtaskId', 'userId'] as $param) {
            \Illuminate\Support\Facades\Route::pattern($param, '[0-9]+');
        }

        // ->local() = same instant in the display timezone, for human formatting.
        \Carbon\Carbon::macro('local', fn () => \App\Support\LocalTime::of($this));
        \Carbon\CarbonImmutable::macro('local', fn () => \App\Support\LocalTime::of($this));
        \Illuminate\Support\Carbon::macro('local', fn () => \App\Support\LocalTime::of($this));
    }
}
