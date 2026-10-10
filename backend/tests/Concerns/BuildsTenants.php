<?php

namespace Tests\Concerns;

use App\Models\Company;
use App\Models\CoordinatorProfile;
use App\Models\DeanProfile;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\SupervisorProfile;
use App\Models\User;

/**
 * Builds a SECOND school (dean, coordinator, supervisor, intern, company, deployment) next to the seeded
 * ABC school, for the cross-school / cross-role access tests. Seed InternovaSeeder first.
 */
trait BuildsTenants
{
    /** @return array{school: School, dean: User, coordinator: User, supervisor: User, intern: User, company: Company, deployment: InternshipDeployment} */
    protected function makeOtherSchool(string $tag = 'other'): array
    {
        $school = School::create([
            'school_code' => 'SCHOOL-'.strtoupper($tag), 'school_name' => ucfirst($tag).' College', 'address' => 'Manila',
            'contact_email' => "admin@{$tag}.edu", 'contact_number' => '09170000009', 'status' => 'active',
        ]);
        SchoolSubscription::create([
            'school_id' => $school->id, 'plan_id' => SubscriptionPlan::firstOrFail()->id,
            'start_date' => now()->toDateString(), 'end_date' => now()->addYear()->toDateString(), 'status' => 'active',
        ]);

        $make = function (string $role, string $first) use ($school, $tag): User {
            return User::create([
                'name' => "$first $tag", 'email' => "{$role}.{$tag}@internova.test", 'password' => bcrypt('password'),
                'role_id' => Role::where('name', $role)->value('id'), 'school_id' => $school->id,
                'first_name' => $first, 'last_name' => ucfirst($tag), 'status' => 'active', 'email_verified_at' => now(),
            ]);
        };

        $dean = $make('dean', 'Dean');
        DeanProfile::create(['user_id' => $dean->id, 'school_id' => $school->id, 'position' => 'Dean']);
        $coordinator = $make('coordinator', 'Coord');
        CoordinatorProfile::create(['user_id' => $coordinator->id, 'school_id' => $school->id, 'position' => 'Coordinator', 'is_primary_coordinator' => true]);

        $company = Company::create([
            'school_id' => $school->id, 'company_code' => 'CMP-'.strtoupper($tag), 'company_name' => ucfirst($tag).' Corp',
            'address' => 'Pasig', 'latitude' => 14.55, 'longitude' => 121.02, 'allowed_radius_meters' => 200, 'status' => 'active',
        ]);
        $supervisor = $make('supervisor', 'Sup');
        SupervisorProfile::create(['user_id' => $supervisor->id, 'school_id' => $school->id, 'company_id' => $company->id, 'position' => 'Lead']);

        $intern = $make('intern', 'Intern');
        InternProfile::create(['user_id' => $intern->id, 'school_id' => $school->id, 'student_number' => '2024'.random_int(1000, 9999), 'course' => 'BS IT', 'year_level' => '4th Year', 'required_hours' => 480]);
        $deployment = InternshipDeployment::create([
            'school_id' => $school->id, 'intern_id' => $intern->id, 'company_id' => $company->id, 'coordinator_id' => $coordinator->id,
            'start_date' => now()->subMonth()->toDateString(), 'end_date' => now()->addMonths(2)->toDateString(), 'required_hours' => 480, 'status' => 'active',
        ]);

        return compact('school', 'dean', 'coordinator', 'supervisor', 'intern', 'company', 'deployment');
    }
}
