<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Auto-generated daily summaries no longer wait for supervisor approval
 * (see DailyActivity::RECORDED). Moves the ones still sitting in "pending"
 * over; entries the supervisor already decided on keep their decision.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('daily_activities')
            ->where('is_auto_generated', true)
            ->where('status', 'pending')
            ->update(['status' => 'recorded']);
    }

    public function down(): void
    {
        DB::table('daily_activities')
            ->where('status', 'recorded')
            ->update(['status' => 'pending']);
    }
};
