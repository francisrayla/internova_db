<?php

namespace Tests\Feature;

use App\Models\PaymentTransaction;
use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\PaymentActivation;
use App\Services\PaymentReceipts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Every paid payment has a receipt: the Dean sees their own school's, the Super Admin sees any school's. */
class PaymentReceiptsTest extends TestCase
{
    use RefreshDatabase;

    private User $superadmin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        SubscriptionPlan::where('name', 'Basic')->update(['monthly_price' => 1500, 'yearly_price' => 15000]);
        $this->superadmin = User::where('email', 'superadmin@internova.test')->first();
    }

    /** A school approved with an offer, its Dean, and the subscription paid with the given method. */
    private function paidSchool(string $code, string $email, string $method, float $amount = 1500, float $listPrice = 1500): array
    {
        Sanctum::actingAs($this->superadmin);
        $dean = User::create([
            'role_id' => Role::where('name', 'dean')->value('id'), 'name' => 'Ana Cruz', 'first_name' => 'Ana', 'last_name' => 'Cruz',
            'email' => $email, 'password' => bcrypt('password'), 'status' => 'pending_approval', 'email_verified_at' => now(),
        ]);
        $inquiry = PlanInquiry::create(['school_name' => "{$code} College", 'contact_person' => 'Ana Cruz', 'position' => 'Dean', 'email' => $email, 'user_id' => $dean->id, 'status' => 'new']);
        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", [
            'school_name' => "{$code} College", 'school_code' => $code, 'contact_email' => "office-{$email}",
            'plan_name' => 'Basic', 'billing_period' => 'monthly', 'list_price' => $listPrice, 'amount' => $amount,
            'discount_amount' => $listPrice - $amount,
            'agreement_note' => $listPrice > $amount ? 'Early sign-up discount' : null,
        ])->assertCreated();

        $school = School::where('school_code', $code)->firstOrFail();
        $subscription = $school->subscriptions()->latest('id')->first();
        $subscription->update(['status' => 'accepted', 'accepted_at' => now(), 'payment_method' => $method, 'payment_reference' => 'cs_test_' . $code]);
        PaymentActivation::activate($subscription->fresh());
        $txn = PaymentTransaction::where('subscription_id', $subscription->id)->where('status', 'paid')->firstOrFail();

        return [$school, $dean->fresh(), $txn];
    }

    public function test_the_dean_sees_a_receipt_for_an_e_wallet_payment(): void
    {
        [$school, $dean, $txn] = $this->paidSchool('RCPT-1', 'dean1@school.test', 'gcash');
        Sanctum::actingAs($dean);

        $list = $this->getJson("/api/dean/schools/{$school->id}/receipts")->assertOk()->json('receipts');
        $this->assertCount(1, $list);
        $this->assertSame(PaymentReceipts::number($txn), $list[0]['receipt_number']);
        $this->assertMatchesRegularExpression('/^IN-\d{4}-\d{6}$/', $list[0]['receipt_number']);
        $this->assertSame('GCash', $list[0]['method']);

        $receipt = $this->getJson("/api/dean/schools/{$school->id}/receipts/{$txn->id}")->assertOk()->json('receipt');
        $this->assertSame('Paid', $receipt['status']);
        $this->assertSame('RCPT-1 College', $receipt['billed_to']['school']);
        $this->assertSame('dean1@school.test', $receipt['billed_to']['email']);
        $this->assertSame('Basic', $receipt['plan']);
        $this->assertEquals(1500, $receipt['total']);
        $this->assertEquals(1500, array_sum(array_column($receipt['lines'], 'amount')));
        $this->assertNotEmpty($receipt['covers_from']);
        $this->assertNotEmpty($receipt['covers_until']);
    }

    public function test_a_discounted_payment_shows_the_discount_and_adds_up(): void
    {
        [$school, $dean, $txn] = $this->paidSchool('RCPT-2', 'dean2@school.test', 'maya', 1200, 1500);
        Sanctum::actingAs($dean);

        $receipt = $this->getJson("/api/dean/schools/{$school->id}/receipts/{$txn->id}")->assertOk()->json('receipt');
        $this->assertSame('Maya', $receipt['method']);
        $this->assertEquals(1200, $receipt['total']);
        $this->assertCount(2, $receipt['lines']);
        $this->assertEquals(-300, $receipt['lines'][1]['amount']);
        $this->assertEquals(1200, array_sum(array_column($receipt['lines'], 'amount')));
    }

    public function test_every_method_gets_a_receipt(): void
    {
        foreach (['card' => 'Debit / credit card', 'bank_transfer' => 'Bank transfer'] as $method => $label) {
            [$school, $dean, $txn] = $this->paidSchool('RCPT-' . strtoupper(str_replace('_', '', $method)), str_replace('_', '', $method) . '@school.test', $method);
            Sanctum::actingAs($dean);
            $this->getJson("/api/dean/schools/{$school->id}/receipts/{$txn->id}")->assertOk()->assertJsonPath('receipt.method', $label);
        }
    }

    public function test_a_dean_cannot_read_another_schools_receipts(): void
    {
        [$schoolA, $deanA] = $this->paidSchool('RCPT-A', 'deana@school.test', 'gcash');
        [$schoolB, , $txnB] = $this->paidSchool('RCPT-B', 'deanb@school.test', 'gcash');
        Sanctum::actingAs($deanA);

        // another school's id in the URL is refused by dean.school
        $this->getJson("/api/dean/schools/{$schoolB->id}/receipts")->assertForbidden();
        // and another school's payment through your own school id is not found
        $this->getJson("/api/dean/schools/{$schoolA->id}/receipts/{$txnB->id}")->assertNotFound();
    }

    public function test_an_unpaid_payment_has_no_receipt(): void
    {
        [$school, $dean] = $this->paidSchool('RCPT-3', 'dean3@school.test', 'gcash');
        $pending = PaymentTransaction::create([
            'school_id' => $school->id, 'payment_type' => 'renewal', 'new_plan_id' => SubscriptionPlan::where('name', 'Basic')->value('id'), 'payment_method' => 'gcash',
            'amount' => 1500, 'status' => 'pending', 'gateway_reference' => 'cs_pending',
        ]);
        Sanctum::actingAs($dean);

        $this->getJson("/api/dean/schools/{$school->id}/receipts/{$pending->id}")->assertNotFound();
        $this->assertCount(1, $this->getJson("/api/dean/schools/{$school->id}/receipts")->json('receipts'));
    }

    public function test_the_super_admin_sees_any_schools_receipts_and_others_do_not(): void
    {
        [$school, , $txn] = $this->paidSchool('RCPT-4', 'dean4@school.test', 'gcash');

        Sanctum::actingAs($this->superadmin);
        $this->getJson("/api/superadmin/schools/{$school->id}/receipts")->assertOk()->assertJsonCount(1, 'receipts');
        $this->getJson("/api/superadmin/schools/{$school->id}/receipts/{$txn->id}")->assertOk()
            ->assertJsonPath('receipt.receipt_number', PaymentReceipts::number($txn));
        $this->getJson('/api/superadmin/schools/999999/receipts')->assertNotFound();

        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->first());
        $this->getJson("/api/superadmin/schools/{$school->id}/receipts/{$txn->id}")->assertForbidden();
    }
}
