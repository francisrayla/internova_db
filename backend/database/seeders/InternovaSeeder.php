<?php

namespace Database\Seeders;

use App\Models\Company;
use App\Models\CoordinatorProfile;
use App\Models\EvaluationCriterion;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Seeder;

class InternovaSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            ['name' => 'super_admin', 'description' => 'System super administrator'],
            ['name' => 'coordinator', 'description' => 'School coordinator — the primary coordinator registers the school, accepts the subscription offer, pays, and manages billing; additional coordinators handle internship operations only'],
            ['name' => 'supervisor', 'description' => 'Company supervisor'],
            ['name' => 'intern', 'description' => 'Student intern'],
        ];

        foreach ($roles as $role) {
            Role::firstOrCreate(['name' => $role['name']], $role);
        }

        $school = School::firstOrCreate(
            ['school_code' => 'SCHOOL-001'],
            [
                'school_name' => 'ABC Technical College',
                'address' => 'Quezon City',
                'contact_email' => 'admin@abctech.edu',
                'contact_number' => '09170000001',
                'status' => 'active',
            ]
        );

        $plan = SubscriptionPlan::firstOrCreate(
            ['name' => 'Premium'],
            [
                'description' => 'Full intern monitoring suite',
                'price' => 4999.00,
                'billing_cycle' => 'monthly',
                'is_active' => true,
            ]
        );

        SchoolSubscription::firstOrCreate(
            ['school_id' => $school->id],
            [
                'plan_id' => $plan->id,
                'start_date' => now()->toDateString(),
                'end_date' => now()->addYear()->toDateString(),
                'status' => 'active',
            ]
        );

        $superAdminRole = Role::where('name', 'super_admin')->first();
        $coordinatorRole = Role::where('name', 'coordinator')->first();
        $supervisorRole = Role::where('name', 'supervisor')->first();
        $internRole = Role::where('name', 'intern')->first();

        $superAdmin = User::firstOrCreate(
            ['email' => 'superadmin@internova.test'],
            [
                'name' => 'Super Admin',
                'role_id' => $superAdminRole?->id,
                'school_id' => $school->id,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'password' => bcrypt('password'),
                'status' => 'active',
            ]
        );

        $coordinator = User::firstOrCreate(
            ['email' => 'coordinator@internova.test'],
            [
                'name' => 'Maria Lopez',
                'role_id' => $coordinatorRole?->id,
                'school_id' => $school->id,
                'first_name' => 'Maria',
                'last_name' => 'Lopez',
                'password' => bcrypt('password'),
                'status' => 'active',
            ]
        );

        CoordinatorProfile::updateOrCreate(
            ['user_id' => $coordinator->id],
            ['school_id' => $school->id, 'position' => 'Program Coordinator', 'is_primary_coordinator' => true]
        );

        $company = Company::firstOrCreate(
            ['company_code' => 'CMP-1001'],
            [
                'school_id' => $school->id,
                'company_name' => 'ABC Technologies',
                'address' => 'Makati City',
                'contact_email' => 'hr@abctechnologies.com',
                'contact_number' => '09170000002',
                'latitude' => 14.5547,
                'longitude' => 121.0244,
                'allowed_radius_meters' => 200,
                'status' => 'active',
            ]
        );

        $supervisor = User::firstOrCreate(
            ['email' => 'supervisor@internova.test'],
            [
                'name' => 'Jose Dela Cruz',
                'role_id' => $supervisorRole?->id,
                'school_id' => $school->id,
                'first_name' => 'Jose',
                'last_name' => 'Dela Cruz',
                'password' => bcrypt('password'),
                'status' => 'active',
            ]
        );

        SupervisorProfile::firstOrCreate(
            ['user_id' => $supervisor->id],
            ['school_id' => $school->id, 'company_id' => $company->id, 'position' => 'Operations Supervisor']
        );

        $intern = User::firstOrCreate(
            ['email' => 'intern@internova.test'],
            [
                'name' => 'Rina Santos',
                'role_id' => $internRole?->id,
                'school_id' => $school->id,
                'first_name' => 'Rina',
                'last_name' => 'Santos',
                'password' => bcrypt('password'),
                'status' => 'active',
            ]
        );

        InternProfile::firstOrCreate(
            ['user_id' => $intern->id],
            ['school_id' => $school->id, 'student_number' => '20240001', 'course' => 'BS Information Technology', 'year_level' => '4th Year', 'required_hours' => 480]
        );

        $deployment = InternshipDeployment::firstOrCreate(
            ['intern_id' => $intern->id, 'company_id' => $company->id],
            [
                'school_id' => $school->id,
                'supervisor_id' => $supervisor->id,
                'coordinator_id' => $coordinator->id,
                'start_date' => now()->subMonths(1)->toDateString(),
                'end_date' => now()->addMonths(2)->toDateString(),
                'required_hours' => 480,
                'status' => 'active',
            ]
        );

        Task::firstOrCreate(
            ['deployment_id' => $deployment->id, 'title' => 'Prepare onboarding checklist'],
            [
                'assigned_by' => $supervisor->id,
                'assigned_to' => $intern->id,
                'description' => 'Complete the onboarding checklist for the trainee.',
                'priority' => 'high',
                'status' => 'pending',
            ]
        );

        EvaluationCriterion::firstOrCreate(
            ['school_id' => $school->id, 'name' => 'Attendance'],
            ['description' => 'Punctuality and attendance', 'max_score' => 5, 'weight' => 1, 'status' => 'active']
        );
    }
}
