<?php

namespace Tests\Feature;

use App\Mail\PasswordReset;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * A recovery code is only sent to an email that has an account able to sign in; anything else
 * is told so, so a mistyped address is noticed right away.
 */
class ForgotPasswordTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function make(string $email, array $attrs = []): User
    {
        return User::create(array_merge([
            'name' => 'Test Person', 'first_name' => 'Test', 'last_name' => 'Person', 'email' => $email,
            'password' => bcrypt('password'), 'role_id' => Role::where('name', 'intern')->value('id'),
            'status' => 'active', 'email_verified_at' => now(),
        ], $attrs));
    }

    public function test_an_unknown_email_is_warned_and_nothing_is_sent(): void
    {
        $this->postJson('/api/auth/forgot-password', ['email' => 'nobody@example.test'])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', fn ($m) => str_contains($m, "couldn't find an account"));

        Mail::assertNothingQueued();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_an_account_that_was_never_activated_is_told_to_use_its_invitation(): void
    {
        $this->make('pending@example.test', ['password' => null, 'status' => 'pending_activation']);

        $this->postJson('/api/auth/forgot-password', ['email' => 'pending@example.test'])
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'invitation'));
        Mail::assertNothingQueued();
    }

    public function test_a_deactivated_account_is_not_sent_a_code(): void
    {
        $this->make('gone@example.test', ['status' => 'inactive']);

        $this->postJson('/api/auth/forgot-password', ['email' => 'gone@example.test'])
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'deactivated'));
        Mail::assertNothingQueued();
    }

    public function test_a_real_account_gets_its_code(): void
    {
        $this->make('real@example.test');

        $this->postJson('/api/auth/forgot-password', ['email' => 'real@example.test'])
            ->assertOk()
            ->assertJsonPath('success', true);

        Mail::assertQueued(PasswordReset::class, 1);
        $this->assertDatabaseHas('password_reset_tokens', ['email' => 'real@example.test']);
    }

    public function test_the_email_must_look_like_an_email(): void
    {
        $this->postJson('/api/auth/forgot-password', ['email' => 'not-an-email'])->assertStatus(422);
        Mail::assertNothingQueued();
    }
}
