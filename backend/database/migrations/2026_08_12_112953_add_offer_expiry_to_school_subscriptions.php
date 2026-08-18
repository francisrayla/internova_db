<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::statement('ALTER TABLE school_subscriptions MODIFY start_date DATE NULL');

        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->timestamp('offer_expires_at')->nullable()->after('offer_sent_at');
        });

        // Offers created before this migration didn't reserve dates until payment —
        // clear stale start/end dates on any subscription still awaiting money.
        DB::table('school_subscriptions')
            ->whereIn('status', ['awaiting_acceptance', 'accepted', 'pending_payment'])
            ->update(['start_date' => null, 'end_date' => null]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->dropColumn('offer_expires_at');
        });

        DB::statement('ALTER TABLE school_subscriptions MODIFY start_date DATE NOT NULL');
    }
};
