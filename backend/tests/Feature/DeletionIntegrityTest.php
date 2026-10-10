<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\DeploymentTransfer;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Deleting people and companies must never silently destroy the history attached to them:
 * a supervisor with tasks/evaluations is deactivated (records stay), a company or intern with
 * anything on file is refused, and an empty one is removed cleanly.
 */
class DeletionIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private Company $company;
    private User $seededSupervisor;
    private User $second;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->company = Company::findOrFail($this->dep->company_id);
        $this->seededSupervisor = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->second = $this->makeSupervisor('second.sup@gmail.com', $this->company);
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
    }

    private function makeSupervisor(string $email, Company $company): User
    {
        $user = User::create([
            'name' => 'Sam Second', 'email' => $email, 'password' => Hash::make('password123'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $company->school_id,
            'first_name' => 'Sam', 'last_name' => 'Second', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $user->id, 'school_id' => $company->school_id, 'company_id' => $company->id]);

        return $user;
    }

    private function task(User $by): Task
    {
        return Task::create(['company_id' => $this->company->id, 'assigned_by' => $by->id, 'title' => 'Prepare report', 'status' => 'pending']);
    }

    // ---- 3. supervisors ---------------------------------------------------------------------------

    public function test_deleting_a_supervisor_with_tasks_and_evaluations_keeps_those_records(): void
    {
        $task = $this->task($this->second);
        $evaluation = Evaluation::create([
            'deployment_id' => $this->dep->id, 'evaluator_id' => $this->second->id,
            'evaluation_date' => '2026-10-01', 'overall_score' => 88, 'status' => 'submitted',
        ]);

        $this->deleteJson("/api/coordinator/supervisors/{$this->second->id}")
            ->assertOk()
            ->assertJsonPath('kept_records', true)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'kept'));

        // The account row survives (so nothing cascades), but it is deactivated and off the company.
        $this->assertNotNull(User::find($this->second->id));
        $this->assertSame('inactive', User::find($this->second->id)->status);
        $this->assertNull(SupervisorProfile::where('user_id', $this->second->id)->first());
        $this->assertNotNull(Task::find($task->id));
        $this->assertSame($this->second->id, Task::find($task->id)->assigned_by);
        $this->assertNotNull(Evaluation::find($evaluation->id));

        // They can no longer sign in, and are gone from the supervisors list.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => 'second.sup@gmail.com', 'password' => 'password123'])->assertStatus(403);
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $ids = collect($this->getJson('/api/coordinator/supervisors')->json('supervisors'))->pluck('user_id');
        $this->assertFalse($ids->contains($this->second->id));
    }

    public function test_deleting_a_supervisor_with_no_history_removes_the_account(): void
    {
        $this->deleteJson("/api/coordinator/supervisors/{$this->second->id}")
            ->assertOk()
            ->assertJsonPath('kept_records', false);

        $this->assertNull(User::find($this->second->id));
    }

    public function test_a_supervisor_who_corrected_attendance_counts_as_having_history(): void
    {
        DB::table('attendances')->insert([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-01', 'clock_in' => '2026-10-01 08:00:00',
            'clock_out' => '2026-10-01 17:00:00', 'status' => 'approved', 'edited_by' => $this->second->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->deleteJson("/api/coordinator/supervisors/{$this->second->id}")->assertOk()->assertJsonPath('kept_records', true);

        $this->assertSame($this->second->id, DB::table('attendances')->where('deployment_id', $this->dep->id)->value('edited_by'));
    }

    public function test_the_last_supervisor_of_a_company_cannot_be_removed(): void
    {
        $this->deleteJson("/api/coordinator/supervisors/{$this->second->id}")->assertOk();
        $this->deleteJson("/api/coordinator/supervisors/{$this->seededSupervisor->id}")->assertStatus(422);

        $this->assertNotNull(SupervisorProfile::where('user_id', $this->seededSupervisor->id)->first());
    }

    // ---- 4. companies -------------------------------------------------------------------------------

    public function test_company_with_active_deployments_is_refused_with_a_clear_message(): void
    {
        $res = $this->deleteJson("/api/coordinator/companies/{$this->company->id}")->assertStatus(422);

        $this->assertStringContainsString('still active', $res->json('message'));
        $this->assertNotNull(Company::find($this->company->id));
        $this->assertNotNull(InternshipDeployment::find($this->dep->id));
    }

    public function test_company_with_only_tasks_on_file_is_refused_instead_of_cascading_them_away(): void
    {
        $empty = Company::create(['school_id' => $this->company->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Tasks Only Inc', 'status' => 'active']);
        $task = Task::create(['company_id' => $empty->id, 'assigned_by' => $this->seededSupervisor->id, 'title' => 'Old task', 'status' => 'completed']);

        $this->deleteJson("/api/coordinator/companies/{$empty->id}")->assertStatus(422);

        $this->assertNotNull(Company::find($empty->id));
        $this->assertNotNull(Task::find($task->id));
    }

    public function test_company_with_a_transfer_history_is_refused_and_an_empty_company_is_deleted(): void
    {
        $other = Company::create(['school_id' => $this->company->school_id, 'company_code' => 'CMP-8', 'company_name' => 'Other Co', 'status' => 'active']);
        DeploymentTransfer::create([
            'deployment_id' => $this->dep->id, 'from_company_id' => $other->id, 'to_company_id' => $this->company->id,
            'transferred_on' => '2026-09-01', 'approved_hours_at_transfer' => 0, 'transferred_by' => null,
        ]);
        $this->deleteJson("/api/coordinator/companies/{$other->id}")->assertStatus(422);

        $empty = Company::create(['school_id' => $this->company->school_id, 'company_code' => 'CMP-7', 'company_name' => 'Nothing Co', 'status' => 'active']);
        $this->deleteJson("/api/coordinator/companies/{$empty->id}")->assertOk();
        $this->assertNull(Company::find($empty->id));
    }

    // ---- 5. interns -----------------------------------------------------------------------------------

    public function test_intern_with_only_journal_entries_is_not_deleted(): void
    {
        DailyActivity::create(['deployment_id' => $this->dep->id, 'activity_date' => '2026-10-01', 'title' => 'Report', 'description' => 'Worked on the report']);

        $this->deleteJson("/api/coordinator/interns/{$this->dep->id}")->assertStatus(422);

        $this->assertNotNull(InternshipDeployment::find($this->dep->id));
        $this->assertNotNull(User::find($this->dep->intern_id));
    }

    public function test_an_intern_with_nothing_on_file_is_deleted_completely(): void
    {
        $clean = InternshipDeployment::firstOrFail();
        DB::table('attendances')->where('deployment_id', $clean->id)->delete();
        DB::table('daily_activities')->where('deployment_id', $clean->id)->delete();
        DB::table('task_assignees')->where('deployment_id', $clean->id)->delete();
        DB::table('evaluations')->where('deployment_id', $clean->id)->delete();
        DB::table('documents')->where('deployment_id', $clean->id)->delete();
        DB::table('portfolios')->where('intern_id', $clean->intern_id)->delete();
        DB::table('messages')->where('sender_id', $clean->intern_id)->orWhere('receiver_id', $clean->intern_id)->delete();
        $internId = $clean->intern_id;

        $this->deleteJson("/api/coordinator/interns/{$clean->id}")->assertOk();

        $this->assertNull(InternshipDeployment::find($clean->id));
        $this->assertNull(User::find($internId));
        $this->assertNull(InternProfile::where('user_id', $internId)->first());
    }

    public function test_reassigning_to_a_company_that_is_no_longer_active_is_refused(): void
    {
        $other = Company::create(['school_id' => $this->company->school_id, 'company_code' => 'CMP-6', 'company_name' => 'Paused Co', 'status' => 'inactive']);

        $this->postJson("/api/coordinator/interns/{$this->dep->id}/reassign", ['company_id' => $other->id])->assertStatus(422);

        $this->assertSame($this->company->id, $this->dep->fresh()->company_id);
        $this->assertSame(0, DeploymentTransfer::count());
    }
}
