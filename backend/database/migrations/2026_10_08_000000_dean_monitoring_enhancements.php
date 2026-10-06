<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // When a coordinator approved/rejected the document (older rows stay null;
        // the scorecard then estimates from updated_at).
        Schema::table('documents', function (Blueprint $table) {
            $table->timestamp('reviewed_at')->nullable();
        });

        // Two-way feedback: open -> acknowledged -> resolved. Existing rows become "open".
        Schema::table('dean_feedback', function (Blueprint $table) {
            $table->string('status', 20)->default('open');
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
        });

        Schema::create('dean_feedback_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dean_feedback_id')->constrained('dean_feedback')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('sender_role', 20); // dean | coordinator
            $table->text('message');
            $table->timestamp('read_at')->nullable(); // read by the other side
            $table->timestamps();

            $table->index(['dean_feedback_id', 'sender_role', 'read_at'], 'dfr_thread_unread_idx');
        });

        Schema::table('dean_profiles', function (Blueprint $table) {
            $table->boolean('weekly_summary_email')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('dean_profiles', function (Blueprint $table) {
            $table->dropColumn('weekly_summary_email');
        });
        Schema::dropIfExists('dean_feedback_replies');
        Schema::table('dean_feedback', function (Blueprint $table) {
            $table->dropColumn(['status', 'acknowledged_at', 'resolved_at']);
        });
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('reviewed_at');
        });
    }
};
