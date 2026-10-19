<?php

namespace Tests\Feature;

use App\Models\PlanInquiry;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Terms and Conditions + Privacy Notice acceptance on every account-creating endpoint. */
class TermsAcceptanceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function registration(array $over = []): array
    {
        return array_merge([
            'school_name' => 'Terms College', 'contact_person' => 'Pat Dean', 'position' => 'Dean',
            'email' => 'pat.terms@gmail.com', 'phone' => '09171234567', 'message' => 'Hello',
            'password' => 'password123', 'password_confirmation' => 'password123',
        ], $over);
    }

    private function invite(string $email, string $role): array
    {
        $user = User::where('email', $email)->firstOrFail();
        $token = 'terms-token-' . $role;
        $user->update(['invitation_token' => hash('sha256', $token), 'invitation_expires_at' => now()->addDay(), 'status' => 'pending_activation']);

        return [$user, $token];
    }

    public function test_registration_without_agreeing_is_rejected_with_a_clear_message(): void
    {
        $this->postJson('/api/inquiries', $this->registration())
            ->assertStatus(422)
            ->assertJsonValidationErrors('accept_terms')
            ->assertJsonPath('errors.accept_terms.0', 'You need to agree to the Terms and Conditions and the Privacy Notice to register.');
        $this->postJson('/api/inquiries', $this->registration(['accept_terms' => false]))->assertStatus(422);

        $this->assertNull(User::where('email', 'pat.terms@gmail.com')->first());
        $this->assertSame(0, PlanInquiry::where('email', 'pat.terms@gmail.com')->count());
    }

    public function test_registration_stores_the_acceptance_and_version_on_user_and_inquiry(): void
    {
        $this->postJson('/api/inquiries', $this->registration(['accept_terms' => true]))->assertCreated();

        $user = User::where('email', 'pat.terms@gmail.com')->firstOrFail();
        $inquiry = PlanInquiry::where('user_id', $user->id)->firstOrFail();

        $this->assertNotNull($user->terms_accepted_at);
        $this->assertSame(config('internova.terms_version'), $user->terms_version);
        $this->assertNotNull($inquiry->terms_accepted_at);
        $this->assertSame(config('internova.terms_version'), $inquiry->terms_version);
    }

    public function test_converting_the_registration_keeps_the_deans_acceptance(): void
    {
        SubscriptionPlan::firstOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'price' => 999, 'billing_cycle' => 'monthly', 'is_active' => true]);
        $this->postJson('/api/inquiries', $this->registration(['accept_terms' => true]))->assertCreated();
        $user = User::where('email', 'pat.terms@gmail.com')->firstOrFail();
        $inquiry = PlanInquiry::where('user_id', $user->id)->firstOrFail();

        // Simulate an older row where only the inquiry recorded the acceptance.
        $user->update(['terms_accepted_at' => null, 'terms_version' => null]);

        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->firstOrFail());
        $price = (float) SubscriptionPlan::where('name', 'Basic')->value('monthly_price');
        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", [
            'school_name' => 'Terms College', 'school_code' => 'TERMS-1', 'contact_email' => 'info@termscollege.test',
            'plan_name' => 'Basic', 'billing_period' => 'monthly', 'list_price' => $price, 'amount' => $price,
        ])->assertCreated();

        $user->refresh();
        $this->assertNotNull($user->school_id);
        $this->assertNotNull($user->terms_accepted_at);
        $this->assertSame($inquiry->terms_version, $user->terms_version);
    }

    public function test_accepting_an_invitation_requires_agreeing(): void
    {
        [$user, $token] = $this->invite('supervisor@internova.test', 'supervisor');
        $body = ['password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123'];

        $this->postJson("/api/invitations/{$token}/accept", $body)
            ->assertStatus(422)
            ->assertJsonValidationErrors('accept_terms')
            ->assertJsonPath('errors.accept_terms.0', 'You need to agree to the Terms and Conditions and the Privacy Notice to activate your account.');

        // Nothing changed: still pending, token still valid.
        $user->refresh();
        $this->assertSame('pending_activation', $user->status);
        $this->assertNull($user->terms_accepted_at);
        $this->assertNotNull($user->invitation_token);
    }

    public function test_accepting_an_invitation_stores_the_acceptance_for_each_invited_role(): void
    {
        foreach (['supervisor@internova.test' => 'supervisor', 'coordinator@internova.test' => 'coordinator', 'dean@internova.test' => 'dean'] as $email => $role) {
            [$user, $token] = $this->invite($email, $role);

            $this->postJson("/api/invitations/{$token}/accept", [
                'password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123', 'accept_terms' => true,
            ])->assertOk();

            $user->refresh();
            $this->assertNotNull($user->terms_accepted_at, $role);
            $this->assertSame(config('internova.terms_version'), $user->terms_version, $role);
        }
    }

    public function test_an_intern_invitation_stores_the_acceptance_too(): void
    {
        $intern = User::whereHas('roles', fn ($q) => $q->where('name', 'intern'))->firstOrFail();
        [$intern, $token] = $this->invite($intern->email, 'intern');

        $this->postJson("/api/invitations/{$token}/accept", [
            'password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123', 'student_number' => '2022-00999',
        ])->assertStatus(422)->assertJsonValidationErrors('accept_terms');

        $this->postJson("/api/invitations/{$token}/accept", [
            'password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123', 'student_number' => '2022-00999', 'accept_terms' => true,
        ])->assertOk();

        $this->assertNotNull($intern->fresh()->terms_accepted_at);
    }

    public function test_the_public_legal_endpoint_gives_the_version_and_support_email(): void
    {
        $this->getJson('/api/legal')
            ->assertOk()
            ->assertJsonPath('terms_version', config('internova.terms_version'))
            ->assertJsonStructure(['support_email']);
    }
}
