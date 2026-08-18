<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    /**
     * Access-pause is now a flag independent of the school's lifecycle status
     * (awaiting_acceptance / accepted / pending_payment / active / offer_expired).
     * Previously "suspended" overwrote that status column directly, so restoring
     * had to guess what the school's real underlying status used to be — this
     * flag means nothing ever needs to be reconstructed or guessed.
     */
    public function up(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->boolean('is_suspended')->default(false)->after('status');
            $table->dateTime('suspended_at')->nullable()->after('is_suspended');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->dropColumn(['is_suspended', 'suspended_at']);
        });
    }
};
