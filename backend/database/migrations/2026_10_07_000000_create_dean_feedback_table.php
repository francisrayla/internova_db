<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Remarks the Dean sends the school's coordinator (read-only for the coordinator).
        Schema::create('dean_feedback', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('dean_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('coordinator_id')->constrained('users')->cascadeOnDelete();
            $table->text('message');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->index(['coordinator_id', 'read_at']);
        });

        // Reliable "last active" for the Dean's view: tokens are deleted at logout/login.
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('last_login_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('last_login_at');
        });
        Schema::dropIfExists('dean_feedback');
    }
};
