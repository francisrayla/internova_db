<?php

namespace Tests\Feature;

use App\Mail\EmailVerification;
use App\Mail\PasswordReset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class ResendCooldownTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-06 04:00:00', 'UTC'));
    }

    private function makeUser(array $attrs = []): User
    {
        return User::create(array_merge([
            'name' => 'Cool Down',
            'first_name' => 'Cool',
            'last_name' => 'Down',
            'email' => 'cooldown@example.test',
            'password' => Hash::make('password123'),
            'role_id' => User::where('email', '!=', '')->value('role_id'),
            'status' => 'active',
        ], $attrs));
    }

    public function test_verification_code_is_not_resent_within_a_minute(): void
    {
        $this->makeUser(['email_verified_at' => null]);

        $this->postJson('/api/auth/resend-verification', ['email' => 'cooldown@example.test'])->assertOk();
        $this->postJson('/api/auth/resend-verification', ['email' => 'cooldown@example.test'])
            ->assertOk()->assertJsonPath('success', true);
        Mail::assertQueuedCount(1);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/auth/resend-verification', ['email' => 'cooldown@example.test'])->assertOk();
        Mail::assertQueued(EmailVerification::class, 2);
    }

    public function test_reset_code_is_not_resent_within_a_minute(): void
    {
        $this->makeUser(['email_verified_at' => now()]);

        $this->postJson('/api/auth/forgot-password', ['email' => 'cooldown@example.test'])->assertOk();
        $this->postJson('/api/auth/forgot-password', ['email' => 'cooldown@example.test'])
            ->assertOk()->assertJsonPath('success', true);
        Mail::assertQueuedCount(1);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/auth/forgot-password', ['email' => 'cooldown@example.test'])->assertOk();
        Mail::assertQueued(PasswordReset::class, 2);
    }
}
