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
        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->timestamp('offer_sent_at')->nullable()->after('status');
            $table->timestamp('accepted_at')->nullable()->after('offer_sent_at');
            $table->string('payment_method')->nullable()->after('accepted_at');
            $table->string('payment_status')->nullable()->after('payment_method');
            $table->string('payment_reference')->nullable()->after('payment_status');
            $table->string('proof_of_payment_path')->nullable()->after('payment_reference');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->dropColumn([
                'offer_sent_at', 'accepted_at', 'payment_method',
                'payment_status', 'payment_reference', 'proof_of_payment_path',
            ]);
        });
    }
};
