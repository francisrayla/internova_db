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
            $table->decimal('list_price', 10, 2)->nullable()->after('plan_id');
            $table->decimal('discount_amount', 10, 2)->nullable()->default(0)->after('amount');
            $table->text('agreement_note')->nullable()->after('discount_amount');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('school_subscriptions', function (Blueprint $table) {
            $table->dropColumn(['list_price', 'discount_amount', 'agreement_note']);
        });
    }
};
