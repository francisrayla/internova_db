<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Security package S1: rate limits on every unauthenticated POST, Sanctum token expiry,
 * and the maintenance switch not locking the Super Admin out.
 */
class AuthHardeningTest extends TestCase
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

    /**
     * The next request starts like a real one: a new PHP process has no guard resolved yet and the
     * default guard is `web`. (Inside one test the app is reused, and the first auth:sanctum request
     * would otherwise leave `sanctum` as the default for every request after it.)
     */
    private function freshRequest(): void
    {
        $this->app['auth']->forgetGuards();
        $this->app['auth']->shouldUse('web');
    }

    private function bearer(User $user): array
    {
        return ['Authorization' => 'Bearer '.$user->createToken('test')->plainTextToken];
    }

    // ---- throttling ------------------------------------------------------

    public function test_login_is_throttled_per_email_with_a_friendly_429(): void
    {
        for ($i = 0; $i < 6; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'wrong'])->assertStatus(401);
        }

        $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'wrong'])
            ->assertStatus(429)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'too_many_requests')
            ->assertJsonStructure(['message', 'retry_after'])
            ->assertHeader('Retry-After');

        // Even the right password is refused while the limit holds.
        $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'password'])->assertStatus(429);

        // Another account from the same client is not affected by that account's lockout.
        $this->postJson('/api/auth/login', ['email' => 'dean@internova.test', 'password' => 'password'])->assertOk();
    }

    public function test_the_email_only_cap_cannot_be_dodged_with_a_spoofed_client_ip(): void
    {
        $status = null;
        for ($i = 1; $i <= 25; $i++) {
            // A different "visitor" every time: the per-person limit never trips, the per-email one must.
            $status = $this->withHeader('X-Client-IP', "10.0.0.{$i}")
                ->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'wrong'])
                ->status();
            if ($status === 429) {
                break;
            }
        }

        $this->assertSame(429, $status);
        $this->assertLessThanOrEqual(21, $i);
    }

    public function test_forgot_password_and_resend_verification_are_throttled(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/forgot-password', ['email' => 'intern@internova.test'])->assertStatus(200);
        }
        $this->postJson('/api/auth/forgot-password', ['email' => 'intern@internova.test'])
            ->assertStatus(429)->assertJsonPath('code', 'too_many_requests');

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/resend-verification', ['email' => 'someone@gmail.com'])->assertStatus(200);
        }
        $this->postJson('/api/auth/resend-verification', ['email' => 'someone@gmail.com'])->assertStatus(429);
    }

    public function test_code_checks_are_throttled(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/verify-email', ['email' => 'x@gmail.com', 'code' => '000000'])->assertStatus(422);
        }
        $this->postJson('/api/auth/verify-email', ['email' => 'x@gmail.com', 'code' => '000000'])->assertStatus(429);

        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/verify-reset-code', ['email' => 'y@gmail.com', 'code' => '000000']);
        }
        $this->postJson('/api/auth/verify-reset-code', ['email' => 'y@gmail.com', 'code' => '000000'])->assertStatus(429);

        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/reset-password', ['email' => 'z@gmail.com', 'code' => '000000', 'password' => 'newpassword1', 'password_confirmation' => 'newpassword1']);
        }
        $this->postJson('/api/auth/reset-password', ['email' => 'z@gmail.com', 'code' => '000000', 'password' => 'newpassword1', 'password_confirmation' => 'newpassword1'])->assertStatus(429);
    }

    public function test_invitation_lookup_and_accept_are_throttled(): void
    {
        $token = str_repeat('a', 64);
        for ($i = 0; $i < 10; $i++) {
            $this->getJson("/api/invitations/{$token}")->assertStatus(404);
        }
        $this->getJson("/api/invitations/{$token}")->assertStatus(429)->assertJsonPath('code', 'too_many_requests');

        $other = str_repeat('b', 64);
        for ($i = 0; $i < 10; $i++) {
            $this->postJson("/api/invitations/{$other}/accept", ['password' => 'password123', 'password_confirmation' => 'password123']);
        }
        $this->postJson("/api/invitations/{$other}/accept", ['password' => 'password123', 'password_confirmation' => 'password123'])->assertStatus(429);
    }

    public function test_public_inquiry_form_is_throttled_per_email(): void
    {
        $payload = fn (string $email) => [
            'school_name' => 'Flood College', 'contact_person' => 'Pat', 'position' => 'Dean',
            'email' => $email, 'phone' => '09171234567', 'message' => 'Hello',
            'password' => 'password123', 'password_confirmation' => 'password123',
        ];

        // Invalid requests (bad e-mail format) still count: that is exactly what a bot sends.
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/inquiries', $payload('nope'))->assertStatus(422);
        }
        $this->postJson('/api/inquiries', $payload('nope'))->assertStatus(429)->assertJsonPath('code', 'too_many_requests');

        // A different address from the same client still gets through (until the per-IP ceiling).
        $this->postJson('/api/inquiries', $payload('real@gmail.com'))->assertCreated();
    }

    public function test_inquiry_form_has_a_per_ip_ceiling(): void
    {
        for ($i = 1; $i <= 10; $i++) {
            $this->postJson('/api/inquiries', ['email' => "bot{$i}@gmail.com"])->assertStatus(422);
        }
        $this->postJson('/api/inquiries', ['email' => 'bot11@gmail.com'])->assertStatus(429);
    }

    public function test_change_password_cannot_be_used_to_guess_the_current_password(): void
    {
        $headers = $this->bearer($this->user('intern@internova.test'));
        $body = ['current_password' => 'wrong', 'new_password' => 'newpassword1', 'new_password_confirmation' => 'newpassword1'];

        for ($i = 0; $i < 6; $i++) {
            $this->freshRequest();
            $this->withHeaders($headers)->postJson('/api/auth/change-password', $body)->assertStatus(422);
        }
        $this->freshRequest();
        $this->withHeaders($headers)->postJson('/api/auth/change-password', $body)->assertStatus(429);
    }

    public function test_normal_use_is_not_throttled(): void
    {
        $headers = $this->bearer($this->user('intern@internova.test'));
        for ($i = 0; $i < 40; $i++) {
            $this->withHeaders($headers)->getJson('/api/notifications')->assertOk();
        }
        $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'password'])->assertOk();
    }

    // ---- token expiry ----------------------------------------------------

    public function test_tokens_expire_after_seven_days(): void
    {
        $this->assertSame(10080, (int) config('sanctum.expiration'));

        $intern = $this->user('intern@internova.test');
        $headers = $this->bearer($intern);

        $this->withHeaders($headers)->getJson("/api/auth/session/{$intern->id}")->assertOk();

        $this->travel(7)->days();
        $this->travel(5)->minutes();

        $this->freshRequest();
        $this->withHeaders($headers)->getJson("/api/auth/session/{$intern->id}")
            ->assertStatus(401)
            ->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_a_fresh_login_token_works_and_a_garbage_token_is_401(): void
    {
        $login = $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'password'])->assertOk();
        $token = $login->json('token');
        $id = $login->json('user.id');

        $this->withHeader('Authorization', "Bearer {$token}")->getJson("/api/auth/session/{$id}")->assertOk();

        $this->freshRequest();
        $this->withHeader('Authorization', 'Bearer 999|notarealtoken')->getJson("/api/auth/session/{$id}")->assertStatus(401);
    }

    // ---- maintenance mode ------------------------------------------------

    private function maintenance(bool $on): void
    {
        Setting::updateOrCreate(['key' => 'maintenance_mode'], ['name' => 'Maintenance', 'description' => 'x', 'type' => 'toggle', 'value' => $on ? '1' : '0']);
    }

    public function test_super_admin_keeps_working_during_maintenance_with_a_real_bearer_token(): void
    {
        $this->maintenance(true);

        // Login itself.
        $login = $this->postJson('/api/auth/login', ['email' => 'superadmin@internova.test', 'password' => 'password']);
        $login->assertOk();
        $headers = ['Authorization' => 'Bearer '.$login->json('token')];

        // And the app after login (this is what was returning 503 before the fix).
        $this->freshRequest();
        $this->withHeaders($headers)->getJson('/api/superadmin/schools')->assertOk();
        $this->freshRequest();
        $this->withHeaders($headers)->getJson('/api/superadmin/system-settings')->assertOk();

        // The Super Admin can switch maintenance off again.
        $this->freshRequest();
        $this->withHeaders($headers)->patchJson('/api/superadmin/system-settings/maintenance_mode', ['value' => false])->assertOk();
    }

    public function test_everyone_else_gets_the_maintenance_response(): void
    {
        $intern = $this->user('intern@internova.test');
        $headers = $this->bearer($intern);
        $this->maintenance(true);

        $this->postJson('/api/auth/login', ['email' => 'intern@internova.test', 'password' => 'password'])
            ->assertStatus(503)->assertJsonPath('maintenance', true);

        $this->withHeaders($headers)->getJson('/api/intern/dashboard')
            ->assertStatus(503)->assertJsonPath('maintenance', true);

        // Anonymous too, but the health check stays up for the maintenance page to poll.
        $this->getJson('/api/notifications')->assertStatus(503);
        $this->getJson('/api/health')->assertOk()->assertJsonPath('maintenance', true);

        $this->maintenance(false);
        $this->freshRequest();
        $this->withHeaders($headers)->getJson('/api/intern/dashboard')->assertOk();
    }

    // ---- devices per account ----------------------------------------------

    private function loginToken(string $email): array
    {
        $this->freshRequest();
        $login = $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'password'])->assertOk();

        return [$login->json('token'), $login->json('user.id')];
    }

    private function assertTokenWorks(string $token, int $id, bool $works): void
    {
        $this->freshRequest();
        $this->withHeader('Authorization', "Bearer {$token}")->getJson("/api/auth/session/{$id}")
            ->assertStatus($works ? 200 : 401);
    }

    public function test_a_supervisor_stays_signed_in_on_two_devices_and_a_third_login_ends_the_oldest(): void
    {
        [$phone, $id] = $this->loginToken('supervisor@internova.test');
        [$laptop] = $this->loginToken('supervisor@internova.test');

        $this->assertTokenWorks($phone, $id, true);
        $this->assertTokenWorks($laptop, $id, true);

        [$tablet] = $this->loginToken('supervisor@internova.test');

        $this->assertTokenWorks($phone, $id, false);
        $this->assertTokenWorks($laptop, $id, true);
        $this->assertTokenWorks($tablet, $id, true);
        $this->assertSame(2, $this->user('supervisor@internova.test')->tokens()->count());
    }

    public function test_every_other_role_has_one_device_at_a_time(): void
    {
        foreach (['intern@internova.test', 'coordinator@internova.test', 'dean@internova.test', 'superadmin@internova.test'] as $email) {
            [$first, $id] = $this->loginToken($email);
            [$second] = $this->loginToken($email);

            $this->assertTokenWorks($first, $id, false);
            $this->assertTokenWorks($second, $id, true);
            $this->assertSame(1, $this->user($email)->tokens()->count(), $email);
        }
    }
}
