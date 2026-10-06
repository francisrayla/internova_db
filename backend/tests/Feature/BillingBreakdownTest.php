<?php

namespace Tests\Feature;

use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\SubscriptionBreakdown;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BillingBreakdownTest extends TestCase
{
    use RefreshDatabase;

    private School $school;
    private SubscriptionPlan $basic;
    private SubscriptionPlan $premium;

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

    private function accepted(float $list, float $discount, ?string $note = null, string $period = 'yearly', ?SubscriptionPlan $plan = null): SchoolSubscription
    {
        return $this->school->subscriptions()->create([
            'plan_id' => ($plan ?? $this->basic)->id, 'status' => 'accepted', 'billing_period' => $period,
            'list_price' => $list, 'discount_amount' => $discount, 'amount' => $list - $discount, 'agreement_note' => $note,
            'accepted_at' => now(),
        ]);
    }

    private function fakePaymongo(): void
    {
        Http::fake(['api.paymongo.com/v1/checkout_sessions' => Http::response([
            'data' => ['id' => 'cs_test_123', 'attributes' => ['checkout_url' => 'https://pm.test/checkout']],
        ])]);
    }

    private function sentLineItem(): array
    {
        $sent = null;
        Http::assertSent(function (HttpRequest $r) use (&$sent) {
            $sent = $r->data()['data']['attributes']['line_items'][0] ?? null;
            return true;
        });

        return $sent;
    }

    public function test_full_price_breakdown_and_checkout_amount_match(): void
    {
        $sub = $this->accepted(15000, 0);
        $b = SubscriptionBreakdown::forSubscription($sub);
        $this->assertEquals(15000, $b['total']);
        $this->assertEquals(0, $b['discount']);
        $this->assertCount(1, $b['lines']);

        $this->fakePaymongo();
        Sanctum::actingAs($this->dean());
        $this->postJson("/api/dean/schools/{$this->school->id}/checkout", ['payment_method' => 'gcash'])->assertOk();

        $item = $this->sentLineItem();
        $this->assertSame((int) round($b['total'] * 100), $item['amount']);
        $this->assertSame('Basic Plan (yearly)', $item['name']);
    }

    public function test_discount_breakdown_has_reason_and_names_the_paymongo_line_item(): void
    {
        $sub = $this->accepted(15000, 5000, 'Pilot school agreement');
        $b = SubscriptionBreakdown::forSubscription($sub);
        $this->assertEquals(10000, $b['total']);
        $this->assertEquals(5000, $b['discount']);
        $this->assertSame('Pilot school agreement', $b['discount_reason']);
        $this->assertEquals($b['total'], array_sum(array_column($b['lines'], 'amount')));

        // The Dean sees it before paying, in the session payload.
        Sanctum::actingAs($this->dean());
        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->assertOk()->json('user');
        $this->assertEquals(10000, $session['subscription_breakdown']['total']);

        $this->fakePaymongo();
        $this->postJson("/api/dean/schools/{$this->school->id}/checkout", ['payment_method' => 'gcash'])->assertOk();
        $item = $this->sentLineItem();
        $this->assertSame(1000000, $item['amount']);
        $this->assertSame('Basic Plan (yearly) — ₱15,000 less ₱5,000 discount', $item['name']);
        $this->assertStringContainsString('Total: ₱10,000', $item['description']);
        $this->assertDatabaseHas('payment_transactions', ['subscription_id' => $sub->id, 'amount' => 10000]);
    }

    public function test_upgrade_proration_breakdown_matches_quote_and_checkout(): void
    {
        // Basic yearly, part of the term used -> prorated difference to Premium.
        $this->school->subscriptions()->create([
            'plan_id' => $this->basic->id, 'status' => 'active', 'billing_period' => 'yearly',
            'list_price' => 15000, 'discount_amount' => 0, 'amount' => 15000, 'payment_status' => 'paid', 'paid_at' => now(),
            'start_date' => '2026-07-07', 'end_date' => '2027-01-23',
        ]);

        Sanctum::actingAs($this->dean());
        $quote = $this->getJson("/api/dean/schools/{$this->school->id}/upgrade-quote?plan_name=Premium&billing_period=yearly")->assertOk()->json();
        $b = $quote['breakdown'];

        $this->assertEquals($quote['quote']['amount_now'], $b['total']);
        $this->assertEquals(35000, $b['plan_price']);
        $this->assertEquals(15000, $b['credit']);
        $this->assertEquals($b['total'], round(array_sum(array_column($b['lines'], 'amount')), 2));
        $this->assertSame('proration', $b['lines'][2]['key']);

        $this->fakePaymongo();
        $this->postJson("/api/dean/schools/{$this->school->id}/upgrade-plan", ['plan_name' => 'Premium', 'billing_period' => 'yearly', 'payment_method' => 'gcash'])->assertOk();
        $item = $this->sentLineItem();
        $this->assertSame((int) round($b['total'] * 100), $item['amount']);
        $this->assertStringContainsString('Upgrade to Premium (yearly)', $item['name']);
        $this->assertDatabaseHas('payment_transactions', ['payment_type' => 'upgrade', 'amount' => $b['total']]);

        // After starting, the session shows the same breakdown for the pending upgrade.
        $pending = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user.pending_upgrade.breakdown');
        $this->assertEquals($b['total'], $pending['total']);
        $this->assertEquals(15000, $pending['credit']);
    }

    public function test_super_admin_school_list_carries_the_breakdown(): void
    {
        $this->accepted(15000, 5000, 'Agreement');
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());
        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('id', $this->school->id);
        $this->assertEquals(10000, $row['breakdown']['total']);
        $this->assertEquals(5000, $row['breakdown']['discount']);
    }
}
