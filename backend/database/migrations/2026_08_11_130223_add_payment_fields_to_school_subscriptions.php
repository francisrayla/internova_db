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
            $table->decimal('amount', 10, 2)->nullable()->after('plan_id');
            $table->string('billing_period')->nullable()->after('amount');
            $table->timestamp('paid_at')->nullable()->after('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->dropColumn(['amount', 'billing_period', 'paid_at']);
        });
    }
};
