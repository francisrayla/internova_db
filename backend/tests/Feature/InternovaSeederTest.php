<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InternovaSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_seed_creates_core_internova_records(): void
    {
        $this->seed(\Database\Seeders\InternovaSeeder::class);

        $this->assertDatabaseHas('roles', ['name' => 'super_admin']);
        $this->assertDatabaseHas('schools', ['school_code' => 'SCHOOL-001']);
        $this->assertDatabaseHas('subscription_plans', ['name' => 'Premium']);
        $this->assertDatabaseHas('companies', ['company_code' => 'CMP-1001']);
        $this->assertDatabaseHas('users', ['email' => 'intern@internova.test']);
        $this->assertDatabaseHas('internship_deployments', ['intern_id' => User::where('email', 'intern@internova.test')->first()?->id]);
        $this->assertTrue(Company::where('company_code', 'CMP-1001')->exists());
        $this->assertTrue(SubscriptionPlan::where('name', 'Premium')->exists());
        $this->assertTrue(School::where('school_code', 'SCHOOL-001')->exists());
        $this->assertTrue(InternshipDeployment::exists());
    }
}
