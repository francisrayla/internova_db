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
            // When true, the supervisor's per-task ratings for this intern
            // (see task_evaluations) feed this line item automatically —
            // scaled to the criterion's own max_score — instead of the
            // supervisor re-scoring the same work a second time by hand.
            $table->boolean('derived_from_task_ratings')->default(false)->after('weight');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('evaluation_criteria', function (Blueprint $table) {
            $table->dropColumn('derived_from_task_ratings');
        });
    }
};
