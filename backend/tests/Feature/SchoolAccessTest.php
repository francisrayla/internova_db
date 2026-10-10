<?php

namespace Tests\Feature;

use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Security package S1: a suspended school, or one whose subscription is expired / unpaid, is locked
 * out by the API itself (403 + a machine-readable code), not just by the frontend layouts.
 */
class SchoolAccessTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function user(string $email): User
    {
        return User::where('email', $email)->first();
    }

    private function school(): School
    {
        return School::where('school_code', 'SCHOOL-001')->first();
    }

    private function subscription(): SchoolSubscription
    {
        return SchoolSubscription::where('school_id', $this->school()->id)->first();
    }

    /** Every role's own landing endpoint, plus the shared school-scoped ones. */
    private function gatedRequests(): array
    {
        return [
            ['intern@internova.test', 'intern/dashboard'],
            ['supervisor@internova.test', 'supervisor/dashboard'],
            ['coordinator@internova.test', 'coordinator/dashboard'],
            ['coordinator@internova.test', 'coordinator/interns'],
            ['dean@internova.test', 'dean/dashboard'],
            ['dean@internova.test', 'dean/school-settings'],
            ['intern@internova.test', 'messages/contacts'],
        ];
    }

    private function assertLockedOut(string $code): void
    {
        foreach ($this->gatedRequests() as [$email, $path]) {
            Sanctum::actingAs($this->user($email));
            $this->getJson("/api/{$path}")
                ->assertStatus(403)
                ->assertJsonPath('success', false)
                ->assertJsonPath('code', $code)
                ->assertJsonStructure(['message']);
        }
    }

    public function test_an_active_school_works_normally(): void
    {
        foreach ($this->gatedRequests() as [$email, $path]) {
            Sanctum::actingAs($this->user($email));
            $this->getJson("/api/{$path}")->assertOk();
        }
    }

    public function test_a_suspended_school_is_locked_out_server_side(): void
    {
        $this->school()->update(['is_suspended' => true, 'suspended_at' => now()]);

        $this->assertLockedOut('school_suspended');

        // Writes too, not just reads.
        Sanctum::actingAs($this->user('intern@internova.test'));
        $this->postJson('/api/intern/attendance/clock-in', [])->assertStatus(403)->assertJsonPath('code', 'school_suspended');
    }

    public function test_an_expired_subscription_is_locked_out_server_side(): void
    {
        $this->subscription()->update(['end_date' => now()->subDay()->toDateString()]);

        $this->assertLockedOut('subscription_expired');
    }

    public function test_an_unpaid_or_unaccepted_subscription_is_locked_out_server_side(): void
    {
        $this->subscription()->update(['status' => 'awaiting_acceptance', 'end_date' => null]);

        $this->assertLockedOut('subscription_unpaid');
    }

    public function test_the_gate_lifts_as_soon_as_access_is_restored(): void
    {
        $this->school()->update(['is_suspended' => true]);
        Sanctum::actingAs($this->user('intern@internova.test'));
        $this->getJson('/api/intern/dashboard')->assertStatus(403);

        $this->school()->update(['is_suspended' => false]);
        Sanctum::actingAs($this->user('intern@internova.test')); // a new request loads the user (and school) afresh
        $this->getJson('/api/intern/dashboard')->assertOk();
    }

    public function test_the_pages_needed_to_see_status_and_pay_stay_reachable(): void
    {
        $this->school()->update(['is_suspended' => true]);
        $this->subscription()->update(['end_date' => now()->subDay()->toDateString()]);
        $school = $this->school();

        foreach (['dean@internova.test', 'coordinator@internova.test', 'intern@internova.test', 'supervisor@internova.test'] as $email) {
            $user = $this->user($email);
            Sanctum::actingAs($user);

            // The session re-check is how the frontend learns the state (suspended / expired) and where to send the user.
            $session = $this->getJson("/api/auth/session/{$user->id}")->assertOk();
            $this->assertTrue($session->json('user.school_suspended'));
            $this->assertSame('expired', $session->json('user.subscription_status'));

            $this->getJson('/api/notifications')->assertOk();
            $this->getJson('/api/notifications/history')->assertOk();
            $this->postJson('/api/auth/logout')->assertOk();
        }

        // Support tickets: the coordinator and the Dean can still write to the platform owner.
        foreach (['coordinator', 'dean'] as $role) {
            Sanctum::actingAs($this->user("{$role}@internova.test"));
            $this->getJson("/api/{$role}/support-tickets")->assertOk();
        }

        // Billing: the Dean can still renew / pay. Whatever the billing code answers, it is not the school gate.
        Sanctum::actingAs($this->user('dean@internova.test'));
        foreach (['accept-offer', 'checkout', 'switch-plan', 'request-plan-change'] as $action) {
            $response = $this->postJson("/api/dean/schools/{$school->id}/{$action}", []);
            $this->assertNotSame('school_suspended', $response->json('code'), "billing {$action} must not be blocked by the school gate");
            $this->assertNotSame('subscription_expired', $response->json('code'));
        }
        $quote = $this->getJson("/api/dean/schools/{$school->id}/upgrade-quote?plan_name=Premium&billing_period=yearly");
        $this->assertNotSame('school_suspended', $quote->json('code'));
        $this->assertNotSame('subscription_expired', $quote->json('code'));
    }

    public function test_the_super_admin_is_never_gated(): void
    {
        $this->school()->update(['is_suspended' => true]);
        $this->subscription()->update(['end_date' => now()->subDay()->toDateString()]);

        Sanctum::actingAs($this->user('superadmin@internova.test'));
        $this->getJson('/api/superadmin/schools')->assertOk();
        $this->getJson('/api/notifications/attention')->assertOk();
    }

    public function test_a_school_without_any_subscription_row_is_not_treated_as_expired(): void
    {
        $this->subscription()->delete();

        Sanctum::actingAs($this->user('intern@internova.test'));
        $this->getJson('/api/intern/dashboard')->assertOk();
    }

    public function test_the_real_login_flow_reports_the_state_the_frontend_gates_on(): void
    {
        $this->school()->update(['is_suspended' => true]);

        $login = $this->postJson('/api/auth/login', ['email' => 'coordinator@internova.test', 'password' => 'password'])->assertOk();
        $this->assertTrue($login->json('user.school_suspended'));

        $token = $login->json('token');
        $this->app['auth']->forgetGuards();
        $this->app['auth']->shouldUse('web');
        $this->withHeader('Authorization', "Bearer {$token}")->getJson('/api/coordinator/dashboard')
            ->assertStatus(403)->assertJsonPath('code', 'school_suspended');
    }
}
