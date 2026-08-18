<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subtask_assignees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subtask_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['subtask_id', 'user_id']);
        });

        // Carry forward every existing single assignment before the column
        // that held it goes away — a subtask can now have several people,
        // but nothing that was already assigned should be lost.
        DB::table('subtasks')->whereNotNull('assigned_to')->orderBy('id')->each(function ($subtask) {
            DB::table('subtask_assignees')->insert([
                'subtask_id' => $subtask->id,
                'user_id' => $subtask->assigned_to,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        Schema::table('subtasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('assigned_to');
        });
    }

    public function down(): void
    {
        Schema::table('subtasks', function (Blueprint $table) {
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
        });

        // Only the first assignee can round-trip back into the old
        // single-column shape — a genuine down-migration accepts that a
        // multi-assignee subtask loses the extra people on rollback.
        DB::table('subtask_assignees')->orderBy('subtask_id')->orderBy('id')->get()->groupBy('subtask_id')->each(function ($rows, $subtaskId) {
            DB::table('subtasks')->where('id', $subtaskId)->update(['assigned_to' => $rows->first()->user_id]);
        });

        Schema::dropIfExists('subtask_assignees');
    }
};
