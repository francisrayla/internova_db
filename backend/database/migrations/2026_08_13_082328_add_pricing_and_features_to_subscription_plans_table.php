<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->decimal('monthly_price', 10, 2)->nullable()->after('description');
            $table->decimal('yearly_price', 10, 2)->nullable()->after('monthly_price');
            $table->json('features')->nullable()->after('yearly_price');
        });

        // Seed the two real tiers with the prices coordinators actually pay
        // today (previously hardcoded in SubscriptionPlan::PRICES) and the
        // feature lists previously hardcoded across two divergent controller
        // responses — this migration makes the table the single source of
        // truth going forward.
        DB::table('subscription_plans')->updateOrInsert(
            ['name' => 'Basic'],
            [
                'description'  => 'Core internship tracking for smaller programs.',
                'monthly_price' => 1500,
                'yearly_price'  => 15000,
                'features'      => json_encode([
                    'GPS + Selfie Attendance',
                    'Parent Task Management',
                    'Pending / Ongoing / Done tracking',
                    'Basic Monitoring',
                ]),
                'is_active'   => true,
                'updated_at'  => now(),
                'created_at'  => now(),
            ]
        );

        DB::table('subscription_plans')->updateOrInsert(
            ['name' => 'Premium'],
            [
                'description'  => 'Full intern monitoring suite for growing programs.',
                'monthly_price' => 3500,
                'yearly_price'  => 35000,
                'features'      => json_encode([
                    'GPS + Selfie Attendance',
                    'Parent Task Management',
                    'Pending / Ongoing / Done tracking',
                    'Basic Monitoring',
                    'Subtasks',
                    'Attachments',
                    'Task Comments',
                    'Real-time Chat',
                    'Per-task Rating + Comments',
                    'Formal Evaluations',
                    'AI Portfolio / Reports',
                ]),
                'is_active'   => true,
                'updated_at'  => now(),
                'created_at'  => now(),
            ]
        );

        // The old single price/billing_cycle columns only ever reflected
        // whichever billing period first created the row and were never the
        // real charge (SubscriptionPlan::PRICES was) — safe to drop now that
        // monthly_price/yearly_price are the real source of truth.
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->dropColumn(['price', 'billing_cycle']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->decimal('price', 10, 2)->default(0);
            $table->string('billing_cycle')->default('monthly');
        });

        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->dropColumn(['monthly_price', 'yearly_price', 'features']);
        });
    }
};
