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

class PlanChangePaymentTest extends TestCase
{
    use RefreshDatabase;

    private School $school;
    private SchoolSubscription $current;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-16 04:00:00', 'UTC'));
        config(['services.paymongo.secret_key' => 'sk_test_fake']);

        $basic = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true]);
        SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);

        $this->school = School::where('school_code', 'SCHOOL-001')->first();
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();

        // Paid monthly term, Oct 1 -> Oct 31 (30 days; 15 left on Oct 16).
        $this->current = $this->school->subscriptions()->create([
            'plan_id' => $basic->id, 'status' => 'active', 'billing_period' => 'monthly',
            'list_price' => 1500, 'discount_amount' => 0, 'amount' => 1500,
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'paid_at' => now(),
            'start_date' => '2026-10-01', 'end_date' => '2026-10-31',
        ]);
        PaymentTransaction::create([
            'school_id' => $this->school->id, 'subscription_id' => $this->current->id, 'payment_type' => 'initial',
            'new_plan_id' => $basic->id, 'payment_method' => 'gcash', 'amount' => 1500, 'status' => 'paid', 'paid_at' => now(),
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

    private function fakePaymongo(string $id): void
    {
        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => Http::response(['data' => ['id' => $id, 'attributes' => ['checkout_url' => 'https://pm.test/c']]]),
            "api.paymongo.com/v1/checkout_sessions/{$id}" => Http::response(['data' => ['attributes' => ['payment_intent' => ['attributes' => ['status' => 'succeeded']]]]]),
        ]);
    }

    private function approve(string $plan, string $period, array $body = []): \Illuminate\Testing\TestResponse
    {
        $req = PlanChangeRequest::create([
            'school_id' => $this->school->id, 'requested_plan' => $plan, 'requested_billing_period' => $period, 'status' => 'pending',
        ]);
        Sanctum::actingAs($this->superAdmin());

        return $this->postJson("/api/superadmin/plan-change-requests/{$req->id}/approve", $body);
    }

    public function test_approved_upgrade_waits_for_payment_then_activates_with_a_transaction(): void
    {
        // Custom rate: Premium monthly 3,500 less 500 = 3,000.
        $this->approve('Premium', 'monthly', ['discount_amount' => 500, 'agreement_note' => 'Partner school'])
            ->assertOk()->assertJsonPath('awaiting_payment', true);

        $offer = SchoolSubscription::where('status', 'accepted')->first();
        $this->assertNotNull($offer);
        $this->assertNull($offer->paid_at);
        $this->assertNotSame('paid', $offer->payment_status);
        $this->assertEquals(3000, $offer->amount);
        $this->assertSame('active', $this->current->fresh()->status);
        $this->assertSame(1, PaymentTransaction::count()); // only the original paid one

        // The Dean sees it with the approved custom amount in the breakdown.
        Sanctum::actingAs($this->dean());
        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertSame('active', $session['subscription_status']);
        $this->assertSame('Premium', $session['approved_change']['plan']);
        $this->assertEquals(3000, $session['approved_change']['breakdown']['total']);
        $this->assertEquals(500, $session['approved_change']['breakdown']['discount']);

        // The Super Admin sees "awaiting payment".
        Sanctum::actingAs($this->superAdmin());
        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('id', $this->school->id);
        $this->assertSame('accepted', $row['awaiting_payment_change']['status']);
        $this->assertEquals(3000, $row['awaiting_payment_change']['amount']);
        $this->assertTrue(collect($this->getJson('/api/superadmin/plan-change-requests')->json('requests'))->first()['awaiting_payment']);

        // Pay through the normal checkout: charged exactly 3,000.
        $this->fakePaymongo('cs_apr');
        Sanctum::actingAs($this->dean());
        $this->postJson("/api/dean/schools/{$this->school->id}/checkout", ['payment_method' => 'gcash'])->assertOk();
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/checkout_sessions') && data_get($r->data(), 'data.attributes.line_items.0.amount') === 300000);
        $this->assertSame('accepted', $offer->fresh()->status);

        $this->postJson("/api/dean/schools/{$this->school->id}/verify-checkout")->assertOk();
        $this->assertSame('active', $offer->fresh()->status);
        $this->assertSame('paid', $offer->fresh()->payment_status);
        $this->assertSame('superseded', $this->current->fresh()->status);
        $this->assertSame(3000.0, (float) PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'paid')->value('amount'));
    }

    public function test_fully_discounted_change_is_activated_by_the_super_admin_as_a_waived_zero_transaction(): void
    {
        $this->approve('Premium', 'monthly', ['discount_amount' => 3500, 'agreement_note' => 'Scholarship partner'])->assertOk();
        $offer = SchoolSubscription::where('status', 'accepted')->first();
        $this->assertEquals(0, $offer->amount);

        // The Dean cannot "pay" 0 through PayMongo.
        Sanctum::actingAs($this->dean());
        $this->postJson("/api/dean/schools/{$this->school->id}/checkout", ['payment_method' => 'gcash'])->assertStatus(422);

        Sanctum::actingAs($this->superAdmin());
        $this->postJson("/api/superadmin/schools/{$this->school->id}/confirm-payment")->assertOk();

        $this->assertSame('active', $offer->fresh()->status);
        $txn = PaymentTransaction::where('subscription_id', $offer->id)->first();
        $this->assertSame('waived', $txn->payment_method);
        $this->assertEquals(0, $txn->amount);
        $this->assertSame('paid', $txn->status);
        $this->assertSame('superseded', $this->current->fresh()->status);
    }

    public function test_monthly_to_yearly_shows_breakdown_charges_the_net_amount_and_starts_a_year_on_payment(): void
    {
        Sanctum::actingAs($this->dean());

        // Quote: 15,000 yearly - credit (1,500 * 15/30 = 750) = 14,250.
        $quote = $this->getJson("/api/dean/schools/{$this->school->id}/upgrade-quote?plan_name=Basic&billing_period=yearly")->assertOk();
        $this->assertEquals(14250, $quote->json('breakdown.total'));
        $this->assertEquals(750, $quote->json('breakdown.credit'));
        $this->assertEquals(14250, $quote->json('quote.amount_now'));

        $this->fakePaymongo('cs_yr');
        $this->postJson("/api/dean/schools/{$this->school->id}/upgrade-plan", ['plan_name' => 'Basic', 'billing_period' => 'yearly', 'payment_method' => 'gcash'])->assertOk();
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/checkout_sessions') && data_get($r->data(), 'data.attributes.line_items.0.amount') === 1425000);

        // Still on the monthly plan until paid; the pending breakdown matches the charge.
        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertSame('monthly', $session['subscription_billing_period']);
        $this->assertEquals(14250, $session['pending_upgrade']['breakdown']['total']);
        $this->assertSame(0, PaymentTransaction::where('status', 'paid')->where('amount', 14250)->count());

        $this->postJson("/api/dean/schools/{$this->school->id}/verify-checkout")->assertOk();

        $yearly = SchoolSubscription::where('billing_period', 'yearly')->first();
        $this->assertSame('active', $yearly->status);
        $this->assertSame('2026-10-16', $yearly->start_date->toDateString());
        $this->assertSame('2027-10-16', $yearly->end_date->toDateString());
        $this->assertSame('superseded', $this->current->fresh()->status);
        $this->assertSame(14250.0, (float) PaymentTransaction::where('subscription_id', $yearly->id)->where('status', 'paid')->value('amount'));
    }

    public function test_yearly_to_monthly_is_still_a_scheduled_switch(): void
    {
        $this->current->update(['billing_period' => 'yearly', 'amount' => 15000, 'list_price' => 15000, 'start_date' => '2026-10-01', 'end_date' => '2027-09-30']);
        Sanctum::actingAs($this->dean());

        $this->postJson("/api/dean/schools/{$this->school->id}/switch-plan", ['plan_name' => 'Basic', 'billing_period' => 'monthly'])
            ->assertOk()->assertJsonPath('scheduled', true);
        $this->assertSame('active', $this->current->fresh()->status);
        $this->assertSame(1, PaymentTransaction::count());
    }

    public function test_a_non_upgrade_approval_is_still_scheduled(): void
    {
        $this->current->update(['plan_id' => SubscriptionPlan::where('name', 'Premium')->value('id'), 'amount' => 3500, 'list_price' => 3500]);
        $this->approve('Basic', 'monthly')->assertOk()->assertJsonPath('scheduled', true);
        $this->assertSame(1, SchoolSubscription::where('status', 'scheduled')->count());
        $this->assertSame(0, SchoolSubscription::where('status', 'accepted')->count());
    }
}
