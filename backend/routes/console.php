<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Monday 7:00 AM Philippine time: weekly summary email for each school's Dean.
// Needs a process running `php artisan schedule:work` (or cron `schedule:run` every minute)
// plus the queue worker to actually deliver it.
Schedule::command('dean:weekly-summary')->weeklyOn(1, '07:00')->timezone('Asia/Manila')->withoutOverlapping();
