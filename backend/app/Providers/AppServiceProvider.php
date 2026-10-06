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
        // ->local() = same instant in the display timezone, for human formatting.
        \Carbon\Carbon::macro('local', fn () => \App\Support\LocalTime::of($this));
        \Carbon\CarbonImmutable::macro('local', fn () => \App\Support\LocalTime::of($this));
        \Illuminate\Support\Carbon::macro('local', fn () => \App\Support\LocalTime::of($this));
    }
}
