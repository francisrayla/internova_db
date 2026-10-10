<?php

namespace Tests\Feature;

use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** QA (super admin): the approve form and the inquiry status endpoint must not trust what the browser says. */
class SuperadminInquiryRulesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        SubscriptionPlan::where('name', 'Basic')->update(['monthly_price' => 1500, 'yearly_price' => 15000]);
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());
    }

    private function inquiry(): PlanInquiry
    {
        $user = User::create([
            'role_id' => Role::where('name', 'dean')->value('id'), 'name' => 'QA Dean', 'first_name' => 'QA', 'last_name' => 'Dean',
            'email' => 'qa-dean@school.test', 'password' => bcrypt('password'), 'status' => 'pending_approval', 'email_verified_at' => now(),
        ]);

        return PlanInquiry::create([
            'school_name' => 'QA College', 'contact_person' => 'QA Dean', 'email' => $user->email, 'user_id' => $user->id, 'status' => 'new',
        ]);
    }

    private function payload(array $over = []): array
    {
        return array_merge([
            'school_name' => 'QA College', 'school_code' => 'QA-1', 'contact_email' => 'qa@school.test',
            'plan_name' => 'Basic', 'billing_period' => 'monthly', 'list_price' => 1500, 'amount' => 1500,
        ], $over);
    }

    public function test_approving_with_a_tampered_amount_or_price_is_refused(): void
    {
        $inquiry = $this->inquiry();
        $url = "/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school";

        $this->postJson($url, $this->payload(['amount' => 1]))->assertStatus(422);
        $this->postJson($url, $this->payload(['list_price' => 1, 'amount' => 1]))->assertStatus(422);
        $this->postJson($url, $this->payload(['discount_amount' => 100, 'agreement_note' => 'promo', 'amount' => 1500]))->assertStatus(422);
        $this->assertSame(0, School::where('school_code', 'QA-1')->count());
        $this->assertNull($inquiry->fresh()->school_id);

        $this->postJson($url, $this->payload(['discount_amount' => 100, 'agreement_note' => 'promo', 'amount' => 1400]))->assertCreated();
        $school = School::where('school_code', 'QA-1')->firstOrFail();
        $this->assertEquals(1400, $school->subscriptions()->latest('id')->value('amount'));
    }

    public function test_an_absurd_amount_is_a_validation_error_not_a_server_error(): void
    {
        $inquiry = $this->inquiry();

        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", $this->payload(['list_price' => 1e15, 'amount' => 1e15]))
            ->assertStatus(422)->assertJsonValidationErrors(['list_price', 'amount']);

        $plan = SubscriptionPlan::where('name', 'Basic')->first();
        $this->patchJson("/api/superadmin/plans/{$plan->id}", ['monthly_price' => 1e15, 'yearly_price' => 1, 'features' => ['A'], 'is_active' => true])
            ->assertStatus(422)->assertJsonValidationErrors(['monthly_price']);
    }

    public function test_plan_screen_does_not_count_an_expired_school_as_active(): void
    {
        $premium = fn () => collect($this->getJson('/api/superadmin/plans-features')->json('plans'))->firstWhere('name', 'Premium');
        $before = $premium()['active_schools'];
        $this->assertGreaterThan(0, $before);

        \App\Models\SchoolSubscription::where('status', 'active')->update(['end_date' => now()->subDays(2)->toDateString()]);

        $this->assertSame(0, $premium()['active_schools']);
    }

    public function test_support_email_setting_must_be_an_email(): void
    {
        \App\Models\Setting::updateOrCreate(['key' => 'support_email'], ['name' => 'Support Email', 'description' => 'x', 'type' => 'text', 'value' => 'help@internova.test']);

        $this->patchJson('/api/superadmin/system-settings/support_email', ['value' => 'not an email'])->assertStatus(422);
        $this->patchJson('/api/superadmin/system-settings/support_email', ['value' => 'help2@internova.test'])->assertOk();
        $this->assertSame('help2@internova.test', \App\Models\Setting::value('support_email'));
    }

    public function test_converted_is_not_a_manual_status_and_an_approved_school_keeps_its_status(): void
    {
        $inquiry = $this->inquiry();

        $this->patchJson("/api/superadmin/plan-inquiries/{$inquiry->id}", ['status' => 'converted'])->assertStatus(422);
        $this->assertSame('new', $inquiry->fresh()->status);

        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", $this->payload())->assertCreated();
        $this->assertSame('converted', $inquiry->fresh()->status);

        $this->patchJson("/api/superadmin/plan-inquiries/{$inquiry->id}", ['status' => 'new'])->assertStatus(422);
        $this->assertSame('converted', $inquiry->fresh()->status);
        // notes can still be edited after approval
        $this->patchJson("/api/superadmin/plan-inquiries/{$inquiry->id}", ['notes' => 'called them'])->assertOk();
    }
}
