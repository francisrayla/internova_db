<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A task moves from "one task = one intern" (deployment_id + assigned_to
 * columns) to "one task = one or more interns" (task_assignees pivot,
 * created by a supervisor for a group or an individual) — and since a
 * supervisor only ever works within one company, the task itself now
 * belongs to a company directly instead of inheriting it through a single
 * deployment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('company_id')->nullable()->after('id')->constrained()->cascadeOnDelete();
        });

        DB::table('tasks')->orderBy('id')->each(function ($task) {
            $deployment = DB::table('internship_deployments')->find($task->deployment_id);
            if (!$deployment) {
                return;
            }

            DB::table('tasks')->where('id', $task->id)->update(['company_id' => $deployment->company_id]);

            DB::table('task_assignees')->insert([
                'task_id' => $task->id,
                'deployment_id' => $deployment->id,
                'user_id' => $task->assigned_to,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('deployment_id');
            $table->dropConstrainedForeignId('assigned_to');
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('deployment_id')->nullable()->constrained('internship_deployments')->nullOnDelete();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
        });

        DB::table('tasks')->orderBy('id')->each(function ($task) {
            $assignee = DB::table('task_assignees')->where('task_id', $task->id)->first();
            if (!$assignee) {
                return;
            }

            DB::table('tasks')->where('id', $task->id)->update([
                'deployment_id' => $assignee->deployment_id,
                'assigned_to' => $assignee->user_id,
            ]);
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_id');
        });
    }
};
