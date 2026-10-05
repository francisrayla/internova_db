<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SuperadminApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    public function test_superadmin_sees_schools_and_plans(): void
    {
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());

        $this->getJson('/api/superadmin/schools')
            ->assertOk()
            ->assertJsonPath('schools.0.name', 'ABC Technical College');

        $this->getJson('/api/superadmin/plans-features')
            ->assertOk()
            ->assertJsonFragment(['name' => 'Premium']);
    }

    public function test_other_roles_are_forbidden(): void
    {
        Sanctum::actingAs(User::where('email', 'intern@internova.test')->first());

        $this->getJson('/api/superadmin/schools')->assertForbidden();
    }

    public function test_guests_are_unauthenticated(): void
    {
        $this->getJson('/api/superadmin/schools')->assertUnauthorized();
    }
}
