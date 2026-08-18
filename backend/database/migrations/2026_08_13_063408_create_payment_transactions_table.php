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
        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('subscription_id')->nullable()->constrained('school_subscriptions')->nullOnDelete();
            $table->string('payment_type'); // initial | upgrade | renewal
            $table->foreignId('previous_plan_id')->nullable()->constrained('subscription_plans')->nullOnDelete();
            $table->foreignId('new_plan_id')->constrained('subscription_plans');
            $table->string('payment_method')->nullable();
            $table->decimal('amount', 10, 2);
            $table->string('status')->default('pending'); // pending | pending_verification | paid | failed
            $table->string('gateway_reference')->nullable();
            $table->string('proof_path')->nullable();
            $table->dateTime('paid_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payment_transactions');
    }
};
