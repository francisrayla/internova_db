<?php

namespace Tests\Feature;

use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DedupePlansTest extends TestCase
{
    use RefreshDatabase;

    private int $basicId;
    private int $dupBasicId;
    private int $dupPremiumId;
    private int $premiumId;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);

        $this->basicId = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true])->id;
        $this->premiumId = SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true])->id;

        // Duplicates created behind the model guard, the way production got them.
        $now = now();
        $this->dupPremiumId = DB::table('subscription_plans')->insertGetId(['name' => 'Premium ', 'description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->dupBasicId = DB::table('subscription_plans')->insertGetId(['name' => 'basic', 'description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
    }

    private function referenceDuplicates(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        $sub = $school->subscriptions()->create([
            'plan_id' => $this->dupBasicId, 'status' => 'superseded', 'billing_period' => 'monthly',
            'list_price' => 1500, 'amount' => 1500, 'start_date' => '2026-10-01', 'end_date' => '2026-11-01',
        ]);
        PaymentTransaction::create([
            'school_id' => $school->id, 'subscription_id' => $sub->id, 'payment_type' => 'upgrade',
            'previous_plan_id' => $this->dupBasicId, 'new_plan_id' => $this->dupPremiumId, 'amount' => 100, 'status' => 'paid',
        ]);
    }

    public function test_pretend_changes_nothing(): void
    {
        $this->referenceDuplicates();
        $before = SubscriptionPlan::count();

        $this->artisan('plans:dedupe', ['--pretend' => true])->assertSuccessful();

        $this->assertSame($before, SubscriptionPlan::count());
        $this->assertDatabaseHas('school_subscriptions', ['plan_id' => $this->dupBasicId]);
        $this->assertDatabaseHas('payment_transactions', ['new_plan_id' => $this->dupPremiumId]);
    }

    public function test_dedupe_repoints_every_reference_keeps_lowest_id_and_is_idempotent(): void
    {
        $this->referenceDuplicates();

        $this->artisan('plans:dedupe')->assertSuccessful();

        $this->assertDatabaseMissing('subscription_plans', ['id' => $this->dupBasicId]);
        $this->assertDatabaseMissing('subscription_plans', ['id' => $this->dupPremiumId]);
        $this->assertDatabaseHas('subscription_plans', ['id' => $this->basicId]);
        $this->assertDatabaseHas('subscription_plans', ['id' => $this->premiumId]);
        $this->assertSame($this->basicId, (int) SchoolSubscription::where('status', 'superseded')->first()->plan_id);
        $txn = PaymentTransaction::first();
        $this->assertSame($this->basicId, (int) $txn->previous_plan_id);
        $this->assertSame($this->premiumId, (int) $txn->new_plan_id);

        // Second run: nothing left to do, nothing changes.
        $count = SubscriptionPlan::count();
        $this->artisan('plans:dedupe')->expectsOutputToContain('No duplicate plans found')->assertSuccessful();
        $this->assertSame($count, SubscriptionPlan::count());
    }

    public function test_new_duplicate_plans_are_rejected_but_existing_plans_stay_editable(): void
    {
        $this->expectException(ValidationException::class);

        try {
            // An existing duplicate can still have its price edited before cleanup.
            SubscriptionPlan::find($this->dupBasicId)->update(['monthly_price' => 1600]);
            $this->assertEquals(1600, SubscriptionPlan::find($this->dupBasicId)->monthly_price);

            // But no new twin, whatever the case or spacing.
            SubscriptionPlan::create(['name' => '  BASIC ', 'description' => 'x', 'monthly_price' => 1, 'yearly_price' => 1, 'is_active' => true]);
        } finally {
            $this->assertSame(0, SubscriptionPlan::where('name', '  BASIC ')->count());
        }
    }
}
