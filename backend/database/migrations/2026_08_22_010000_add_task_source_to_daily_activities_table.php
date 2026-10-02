<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_activities', function (Blueprint $table) {
            $table->foreignId('source_task_id')->nullable()->after('deployment_id')->constrained('tasks')->nullOnDelete();
            $table->foreignId('source_subtask_id')->nullable()->after('source_task_id')->constrained('subtasks')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('daily_activities', function (Blueprint $table) {
            $table->dropConstrainedForeignId('source_task_id');
            $table->dropConstrainedForeignId('source_subtask_id');
        });
    }
};
