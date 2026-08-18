<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('evaluation_criteria', function (Blueprint $table) {
            // Not coordinator-configurable after all — which criteria
            // auto-fill from task ratings is now a fixed rule (the
            // "A. Technical Ability" section) rather than a per-row toggle.
            $table->dropColumn('derived_from_task_ratings');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('evaluation_criteria', function (Blueprint $table) {
            $table->boolean('derived_from_task_ratings')->default(false)->after('weight');
        });
    }
};
