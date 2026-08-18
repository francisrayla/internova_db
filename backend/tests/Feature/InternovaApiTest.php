<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InternovaApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_internova_resources_are_available_via_api(): void
    {
        $this->seed(\Database\Seeders\InternovaSeeder::class);

        $this->getJson('/api/internova/schools')
            ->assertOk()
            ->assertJsonPath('data.0.school_code', 'SCHOOL-001');

        $this->getJson('/api/internova/companies')
            ->assertOk()
            ->assertJsonPath('data.0.company_code', 'CMP-1001');

        $this->getJson('/api/internova/deployments')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }
}
