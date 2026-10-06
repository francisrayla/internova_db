<?php

namespace Tests\Feature;

use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ScheduledSwitchTest extends TestCase
{
    use RefreshDatabase;

    private School $school;
    private SubscriptionPlan $basic;
    private SubscriptionPlan $premium;
    private SchoolSubscription $yearly;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-15 04:00:00', 'UTC'));
        config(['services.paymongo.secret_key' => 'sk_test_fake']);

        $this->basic = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true]);
        $this->premium = SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);

        $this->school = School::where('school_code', 'SCHOOL-001')->first();
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();

        // A school that paid 15,000 for a full year on Oct 1 (like PMFTCI).
        $this->yearly = $this->school->subscriptions()->create([
            'plan_id' => $this->basic->id, 'status' => 'active', 'billing_period' => 'yearly',
            'list_price' => 15000, 'discount_amount' => 0, 'amount' => 15000,
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'paid_at' => now(),
            'start_date' => '2026-10-01', 'end_date' => '2027-09-30',
        ]);
        PaymentTransaction::create([
            'school_id' => $this->school->id, 'subscription_id' => $this->yearly->id, 'payment_type' => 'initial',
            'new_plan_id' => $this->basic->id, 'payment_method' => 'gcash', 'amount' => 15000, 'status' => 'paid', 'paid_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function dean(): User
    {
        return User::where('email', 'dean@internova.test')->first();
    }

    private function superAdmin(): User
    {
        return User::where('email', 'superadmin@internova.test')->first();
    }

    private function switchToMonthly(): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($this->dean());

        return $this->postJson("/api/dean/schools/{$this->school->id}/switch-plan", ['plan_name' => 'Basic', 'billing_period' => 'monthly']);
    }

    public function test_switching_to_a_shorter_period_is_scheduled_and_the_paid_year_is_kept(): void
    {
        $this->switchToMonthly()->assertOk()
            ->assertJsonPath('scheduled', true)
            ->assertJsonPath('starts_on', 'October 01, 2027');

        // Paid yearly term untouched and still the one in charge; no money moved.
        $this->assertSame('active', $this->yearly->fresh()->status);
        $this->assertSame($this->yearly->id, $this->school->currentSubscription()->id);
        $this->assertSame(1, PaymentTransaction::count());

        $scheduled = SchoolSubscription::where('status', 'scheduled')->first();
        $this->assertSame('2027-10-01', $scheduled->start_date->toDateString());
        $this->assertSame('monthly', $scheduled->billing_period);
        $this->assertNull($scheduled->paid_at);

        // The Dean and the Super Admin both see it.
        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertSame('active', $session['subscription_status']);
        $this->assertSame('Basic', $session['scheduled_switch']['plan']);
        $this->assertSame('October 01, 2027', $session['scheduled_switch']['starts_on']);

        Sanctum::actingAs($this->superAdmin());
        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('id', $this->school->id);
        $this->assertSame('monthly', $row['scheduled_switch']['billing_period']);
        $this->assertSame('active', $row['subscription_status']);
        $this->assertEquals(15000, $row['amount']);

        // Super Admin payment tools never pick the scheduled row.
        $this->postJson("/api/superadmin/schools/{$this->school->id}/confirm-payment")->assertStatus(422);
    }

    public function test_scheduled_switch_can_be_cancelled_and_replaced(): void
    {
        $this->switchToMonthly()->assertOk();

        // A second switch replaces the first (only one scheduled at a time).
        $this->postJson("/api/dean/schools/{$this->school->id}/switch-plan", ['plan_name' => 'Basic', 'billing_period' => 'monthly'])->assertOk();
        $this->assertSame(1, SchoolSubscription::where('status', 'scheduled')->count());
        $this->assertSame(1, SchoolSubscription::where('status', 'cancelled')->count());

        $this->postJson("/api/dean/schools/{$this->school->id}/cancel-scheduled-switch")->assertOk();
        $this->assertSame(0, SchoolSubscription::where('status', 'scheduled')->count());
        $this->assertSame('active', $this->yearly->fresh()->status);

        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertNull($session['scheduled_switch']);
    }

    public function test_when_the_paid_term_ends_the_new_plan_is_billed_once_for_its_own_term(): void
    {
        $this->switchToMonthly()->assertOk();

        // Day after the paid term ends.
        Carbon::setTestNow(Carbon::parse('2027-10-05 04:00:00', 'UTC'));

        $current = $this->school->currentSubscription();
        $this->assertSame('accepted', $current->status);
        $this->assertSame('monthly', $current->billing_period);
        $this->assertSame('expired', $this->yearly->fresh()->status);
        $this->assertNull($current->start_date);

        Sanctum::actingAs($this->dean());
        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertSame('accepted', $session['subscription_status']);
        $this->assertEquals(1500, $session['subscription_breakdown']['total']);

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => Http::response(['data' => ['id' => 'cs_test_9', 'attributes' => ['checkout_url' => 'https://pm.test/c']]]),
            'api.paymongo.com/v1/checkout_sessions/cs_test_9' => Http::response(['data' => ['attributes' => ['payment_intent' => ['attributes' => ['status' => 'succeeded']]]]]),
        ]);
        $this->postJson("/api/dean/schools/{$this->school->id}/checkout", ['payment_method' => 'gcash'])->assertOk();
        $this->postJson("/api/dean/schools/{$this->school->id}/verify-checkout")->assertOk();

        $new = $current->fresh();
        $this->assertSame('active', $new->status);
        $this->assertSame('2027-10-05', $new->start_date->toDateString());
        $this->assertSame('2027-11-05', $new->end_date->toDateString());

        // Exactly two payments ever: the original 15,000 year and one 1,500 month. No double charge.
        $this->assertSame([1500.0, 15000.0], PaymentTransaction::where('status', 'paid')->orderBy('amount')->pluck('amount')->map(fn ($a) => (float) $a)->all());
    }

    public function test_an_upgrade_is_still_immediate_and_blocked_while_a_switch_is_scheduled(): void
    {
        // Upgrade path unchanged (Basic yearly -> Premium yearly starts a prorated payment now).
        Http::fake(['api.paymongo.com/v1/checkout_sessions' => Http::response(['data' => ['id' => 'cs_up', 'attributes' => ['checkout_url' => 'https://pm.test/u']]])]);
        Sanctum::actingAs($this->dean());
        $this->postJson("/api/dean/schools/{$this->school->id}/upgrade-plan", ['plan_name' => 'Premium', 'billing_period' => 'yearly', 'payment_method' => 'gcash'])->assertOk();
        $this->assertSame(1, SchoolSubscription::where('status', 'pending_payment')->count());
        $this->postJson("/api/dean/schools/{$this->school->id}/cancel-pending-upgrade")->assertOk();

        // The same plan with a higher price is rejected by switch (needs upgrade).
        $this->postJson("/api/dean/schools/{$this->school->id}/switch-plan", ['plan_name' => 'Premium', 'billing_period' => 'yearly'])->assertStatus(422);

        // With a scheduled switch waiting, an upgrade must wait or the switch be cancelled first.
        $this->switchToMonthly()->assertOk();
        $this->postJson("/api/dean/schools/{$this->school->id}/upgrade-plan", ['plan_name' => 'Premium', 'billing_period' => 'yearly', 'payment_method' => 'gcash'])->assertStatus(422);
    }

    public function test_approved_custom_downgrade_is_scheduled_but_an_upgrade_awaits_payment(): void
    {
        $down = PlanChangeRequest::create([
            'school_id' => $this->school->id, 'requested_plan' => 'Basic', 'requested_billing_period' => 'monthly', 'note' => 'cheaper please', 'status' => 'pending',
        ]);
        Sanctum::actingAs($this->superAdmin());
        $this->postJson("/api/superadmin/plan-change-requests/{$down->id}/approve", [])->assertOk()->assertJsonPath('scheduled', true);

        $this->assertSame('active', $this->yearly->fresh()->status);
        $scheduled = SchoolSubscription::where('status', 'scheduled')->first();
        $this->assertSame('2027-10-01', $scheduled->start_date->toDateString());
        $this->assertSame('approved', $down->fresh()->status);

        // Upgrade at a custom rate is NOT paid by approving it: awaiting payment, paid term untouched.
        $up = PlanChangeRequest::create([
            'school_id' => $this->school->id, 'requested_plan' => 'Premium', 'requested_billing_period' => 'yearly', 'status' => 'pending',
        ]);
        $this->postJson("/api/superadmin/plan-change-requests/{$up->id}/approve", [])->assertOk()->assertJsonPath('awaiting_payment', true);
        $this->assertSame('active', $this->yearly->fresh()->status);
        $this->assertSame('Basic', $this->school->currentSubscription()->plan->name);
        $this->assertSame('accepted', $this->school->latestBillableSubscription()->status);
        // The earlier scheduled switch is replaced by the approved change.
        $this->assertSame(0, SchoolSubscription::where('status', 'scheduled')->count());
    }
}
