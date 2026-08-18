<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The rating is validated as an integer 1–10 (see
 * SupervisorMonitoringController::evaluateTask), but the column was created
 * as decimal(3,2) — max 9.99 — so a perfect score of 10 always overflowed
 * it. No doctrine/dbal in this project, so this uses a raw ALTER instead of
 * Schema::table(...)->change().
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE task_evaluations MODIFY rating DECIMAL(5, 2) NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE task_evaluations MODIFY rating DECIMAL(3, 2) NULL');
    }
};
