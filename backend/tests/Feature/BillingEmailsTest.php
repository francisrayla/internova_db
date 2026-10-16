<?php

namespace Tests\Feature;

use App\Mail\PaymentReceipt;
use App\Mail\SubscriptionOfferReady;
use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\Setting;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\PaymentActivation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The head of a newly approved school gets the offer by email, and one receipt once the payment is in. */
class BillingEmailsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        SubscriptionPlan::where('name', 'Basic')->update(['monthly_price' => 1500, 'yearly_price' => 15000]);
        config(['app.frontend_url' => 'https://app.internova.test']);
        Setting::updateOrCreate(['key' => 'support_email'], ['name' => 'Support email', 'description' => 'x', 'type' => 'text', 'value' => 'help@internova.test']);
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());
    }

    private function approveSchool(): School
    {
        $head = User::create([
            'role_id' => Role::where('name', 'dean')->value('id'), 'name' => 'Ana Cruz', 'first_name' => 'Ana', 'last_name' => 'Cruz',
            'email' => 'head@school.test', 'password' => bcrypt('password'), 'status' => 'pending_approval', 'email_verified_at' => now(),
        ]);
        $inquiry = PlanInquiry::create(['school_name' => 'Mail College', 'contact_person' => 'Ana Cruz', 'position' => 'Principal', 'email' => $head->email, 'user_id' => $head->id, 'status' => 'new']);

        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", [
            'school_name' => 'Mail College', 'school_code' => 'MAIL-1', 'contact_email' => 'office@school.test',
            'plan_name' => 'Basic', 'billing_period' => 'monthly', 'list_price' => 1500, 'amount' => 1500,
        ])->assertCreated();

        return School::where('school_code', 'MAIL-1')->firstOrFail();
    }

    public function test_approving_a_registration_emails_the_offer_to_the_head(): void
    {
        $this->approveSchool();

        Mail::assertQueued(SubscriptionOfferReady::class, 1);
        Mail::assertQueued(SubscriptionOfferReady::class, function (SubscriptionOfferReady $mail) {
            $html = $mail->render();

            return $mail->hasTo('head@school.test')
                && !$mail->resent
                && str_contains($html, '1,500.00')
                && str_contains($html, 'https://app.internova.test/dean/billing')
                && str_contains($html, 'help@internova.test')
                && str_contains($html, 'Principal')
                && !str_contains($html, 'hello@internova.ai');
        });
    }

    public function test_resending_an_expired_offer_emails_the_new_offer(): void
    {
        $school = $this->approveSchool();
        $school->subscriptions()->latest('id')->first()->update(['status' => 'offer_expired', 'offer_expires_at' => now()->subDay()]);
        $school->update(['status' => 'offer_expired']);

        $this->postJson("/api/superadmin/schools/{$school->id}/resend-offer")->assertOk();

        Mail::assertQueued(SubscriptionOfferReady::class, fn (SubscriptionOfferReady $m) => $m->resent && $m->hasTo('head@school.test'));
    }

    public function test_one_receipt_is_sent_even_when_the_payment_is_confirmed_twice(): void
    {
        $school = $this->approveSchool();
        $subscription = $school->subscriptions()->latest('id')->first();
        $subscription->update(['status' => 'accepted', 'accepted_at' => now(), 'payment_method' => 'gcash', 'payment_reference' => 'SUB-' . $subscription->id]);

        $this->assertSame(PaymentActivation::ACTIVATED, PaymentActivation::activate($subscription->fresh())['result']);
        // The webhook and the return flow both confirm the same payment; only the first one sends a receipt.
        $this->assertSame(PaymentActivation::ALREADY_ACTIVE, PaymentActivation::activate($subscription->fresh())['result']);

        Mail::assertQueued(PaymentReceipt::class, 1);
        Mail::assertQueued(PaymentReceipt::class, function (PaymentReceipt $mail) use ($subscription) {
            $html = $mail->render();

            return $mail->hasTo('head@school.test')
                && $mail->receiptNumber === 'SUB-' . $subscription->id
                && $mail->methodLabel === 'GCash'
                && str_contains($html, '1,500.00')
                && str_contains($html, 'Mail College');
        });
    }

    public function test_a_bounced_head_address_gets_no_billing_email(): void
    {
        $school = $this->approveSchool();
        Mail::fake(); // forget the offer from the approval
        User::where('email', 'head@school.test')->update(['email_bounced_at' => now()]);
        $subscription = $school->subscriptions()->latest('id')->first();
        $subscription->update(['status' => 'accepted', 'accepted_at' => now(), 'payment_method' => 'bank_transfer']);

        PaymentActivation::activate($subscription->fresh());

        Mail::assertNotQueued(PaymentReceipt::class);
    }
}
