<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InternovaApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeded_accounts_can_log_in(): void
    {
        $this->seed(\Database\Seeders\InternovaSeeder::class);

        foreach (['superadmin', 'coordinator', 'supervisor', 'intern'] as $account) {
            $this->postJson('/api/auth/login', [
                'email' => "{$account}@internova.test",
                'password' => 'password',
            ])
                ->assertOk()
                ->assertJsonPath('success', true)
                ->assertJsonStructure(['token', 'user']);
        }
    }

    public function test_login_rejects_a_wrong_password(): void
    {
        $this->seed(\Database\Seeders\InternovaSeeder::class);

        $this->postJson('/api/auth/login', [
            'email' => 'intern@internova.test',
            'password' => 'not-the-password',
        ])
            ->assertUnauthorized()
            ->assertJsonPath('success', false);
    }
}
