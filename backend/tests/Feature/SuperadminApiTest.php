<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SuperadminApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_superadmin_dashboard_endpoint_returns_expected_structure(): void
    {
        $response = $this->getJson('/api/superadmin/dashboard');

        $response->assertOk()
            ->assertJsonStructure([
                'stats' => [
                    ['label', 'value', 'note'],
                ],
                'activity' => [
                    ['title', 'detail'],
                ],
                'modules' => [
                    ['name', 'description', 'status'],
                ],
            ]);
    }

    public function test_superadmin_users_endpoint_returns_user_collection(): void
    {
        $response = $this->getJson('/api/superadmin/users');

        $response->assertOk()
            ->assertJsonStructure([
                'users' => [
                    ['id', 'name', 'email', 'role', 'status', 'team'],
                ],
            ]);
    }
}
