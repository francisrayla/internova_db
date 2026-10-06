<?php

namespace Tests\Feature;

use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BillingRevenueTest extends TestCase
{
    use RefreshDatabase;

    private SubscriptionPlan $basic;
    private SubscriptionPlan $premium;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-15 04:00:00', 'UTC'));

        $this->basic = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true]);
        $this->premium = SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);
        // The seeded demo school's subscription must not skew these figures.
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function school(string $code): School
    {
        return School::create(['school_code' => $code, 'school_name' => "School {$code}", 'address' => 'Manila', 'contact_email' => "{$code}@x.test", 'contact_number' => '09170000000', 'status' => 'active']);
    }

    private function sub(School $school, SubscriptionPlan $plan, string $period, string $status, float $list, float $discount = 0, string $payment = 'paid'): SchoolSubscription
    {
        return $school->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => $status, 'billing_period' => $period,
            'list_price' => $list, 'discount_amount' => $discount, 'amount' => $list - $discount,
            'payment_method' => 'gcash', 'payment_status' => $payment, 'paid_at' => now(),
            'start_date' => '2026-01-01', 'end_date' => '2027-12-31',
        ]);
    }

    private function txn(SchoolSubscription $sub, float $amount, string $paidAtUtc, string $status = 'paid'): PaymentTransaction
    {
        return PaymentTransaction::create([
            'school_id' => $sub->school_id, 'subscription_id' => $sub->id, 'payment_type' => 'initial',
            'new_plan_id' => $sub->plan_id, 'payment_method' => 'gcash', 'amount' => $amount,
            'status' => $status, 'paid_at' => $status === 'paid' ? $paidAtUtc : null,
        ]);
    }

    private function asSuperAdmin(): void
    {
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());
    }

    public function test_revenue_counts_only_paid_money_with_manila_month_boundaries(): void
    {
        $a = $this->school('A');
        $b = $this->school('B');
        $c = $this->school('C');

        // Yearly premium, paid this month.
        $this->txn($this->sub($a, $this->premium, 'yearly', 'active', 35000), 35000, '2026-10-10 03:00:00');
        // Discounted yearly basic: 15000 - 5000; paid at 2026-09-30 17:00 UTC = Oct 1 01:00 Manila -> THIS month.
        $this->txn($this->sub($b, $this->basic, 'yearly', 'active', 15000, 5000), 10000, '2026-09-30 17:00:00');
        // Superseded yearly, paid last month (Sep 30 15:59 UTC = Sep 30 23:59 Manila).
        $old = $this->sub($c, $this->basic, 'yearly', 'superseded', 15000);
        $this->txn($old, 15000, '2026-09-30 15:59:00');
        // Monthly basic active, paid through an instant switch: marked paid, NO transaction.
        $this->sub($c, $this->basic, 'monthly', 'active', 1500);
        // A pending and a failed checkout never count.
        $this->txn($this->sub($this->school('D'), $this->basic, 'monthly', 'pending_payment', 1500, 0, 'pending'), 1500, '', 'pending');
        $this->txn($this->sub($this->school('E'), $this->basic, 'monthly', 'pending_payment', 1500, 0, 'pending'), 1500, '', 'failed');

        $this->asSuperAdmin();
        $r = $this->getJson('/api/superadmin/revenue')->assertOk()->json();

        $this->assertEquals(45000, $r['collected_this_month']);
        $this->assertEquals(15000, $r['collected_last_month']);
        $this->assertEquals(60000, $r['total_collected']);
        $this->assertSame(3, $r['active_subscriptions']);
        // 35000/12 + 10000/12 + 1500
        $this->assertEquals(round(35000 / 12 + 10000 / 12 + 1500, 2), $r['recurring_monthly']);
        $this->assertSame('October 2026', $r['this_month_label']);

        $rows = collect($r['breakdown']);
        $this->assertCount(4, $rows);
        $discounted = $rows->firstWhere('school', 'School B');
        $this->assertEquals(15000, $discounted['list_price']);
        $this->assertEquals(5000, $discounted['discount']);
        $this->assertEquals(10000, $discounted['amount_paid']);
        $this->assertTrue($discounted['recorded']);
        $unrecorded = $rows->first(fn ($x) => $x['school'] === 'School C' && $x['billing_period'] === 'monthly');
        $this->assertFalse($unrecorded['recorded']);
        $this->assertEquals(0, $unrecorded['amount_paid']);
    }

    public function test_expired_active_subscription_is_not_recurring_and_only_super_admin_can_read(): void
    {
        $a = $this->school('A');
        $s = $this->sub($a, $this->basic, 'monthly', 'active', 1500);
        $s->update(['end_date' => '2026-10-01']);

        $this->asSuperAdmin();
        $r = $this->getJson('/api/superadmin/revenue')->assertOk()->json();
        $this->assertSame(0, $r['active_subscriptions']);
        $this->assertEquals(0, $r['recurring_monthly']);

        Sanctum::actingAs(User::where('email', 'dean@internova.test')->first());
        $this->getJson('/api/superadmin/revenue')->assertForbidden();
    }

    public function test_manual_confirmation_records_a_paid_transaction(): void
    {
        $a = $this->school('A');
        $s = $this->sub($a, $this->basic, 'monthly', 'accepted', 1500, 0, 'pending');
        $s->update(['start_date' => null, 'end_date' => null]);

        $this->asSuperAdmin();
        $this->postJson("/api/superadmin/schools/{$a->id}/confirm-payment")->assertOk();

        $this->assertDatabaseHas('payment_transactions', ['subscription_id' => $s->id, 'status' => 'paid', 'amount' => 1500]);
        $this->assertEquals(1500, $this->getJson('/api/superadmin/revenue')->json('collected_this_month'));
    }
}
