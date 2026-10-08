<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Supervisors are per COMPANY now: every active supervisor of a company
 * handles every intern deployed there, with identical powers.
 */
class SupervisorCompanyScopeTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $supA;
    private User $supB;
    private User $stranger;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->supA = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->supB = $this->makeSupervisor('second@internova.test', 'Onyok', 'Padilla', $this->dep->company_id);
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $this->stranger = $this->makeSupervisor('stranger@internova.test', 'Ana', 'Reyes', $other->id);
    }

    private function makeSupervisor(string $email, string $first, string $last, int $companyId): User
    {
        $u = User::create([
            'name' => "$first $last", 'email' => $email, 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => $first, 'last_name' => $last, 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $u->id, 'school_id' => $this->dep->school_id, 'company_id' => $companyId]);

        return $u;
    }

    private function attendance(string $day = '2026-05-04'): Attendance
    {
        return Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => $day,
            'clock_in' => "$day 08:00:00", 'clock_out' => "$day 17:00:00", 'status' => 'pending',
        ]);
    }

    public function test_the_legacy_supervisor_column_is_ignored_for_access(): void
    {
        $this->dep->update(['supervisor_id' => $this->supA->id]); // legacy value pointing at A only
        foreach ([$this->supA, $this->supB] as $sup) {
            Sanctum::actingAs($sup);
            $this->assertCount(1, $this->getJson('/api/supervisor/interns')->assertOk()->json('interns'));
        }
        Sanctum::actingAs($this->stranger);
        $this->assertCount(0, $this->getJson('/api/supervisor/interns')->assertOk()->json('interns'));
    }

    public function test_both_supervisors_are_listed_on_the_intern_row(): void
    {
        Sanctum::actingAs($this->supB);
        $name = $this->getJson('/api/supervisor/interns')->json('interns.0.supervisor_name');
        $this->assertStringContainsString('Onyok Padilla', $name);
        $this->assertStringContainsString($this->supA->first_name, $name);
        $this->assertSame(2, substr_count($name, ',') + 1);
    }

    public function test_either_supervisor_can_review_attendance_and_a_stranger_cannot(): void
    {
        $a = $this->attendance();
        Sanctum::actingAs($this->supB);
        $this->patchJson("/api/supervisor/attendance/{$a->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', $a->fresh()->status);

        Sanctum::actingAs($this->supA);
        $this->assertSame('approved', $this->getJson('/api/supervisor/attendance')->json('records.0.status'));

        $b = $this->attendance('2026-05-05');
        Sanctum::actingAs($this->stranger);
        $this->patchJson("/api/supervisor/attendance/{$b->id}", ['status' => 'approved'])->assertStatus(404);
        $this->assertSame('pending', $b->fresh()->status);
    }

    public function test_either_supervisor_can_approve_activities_and_approve_all(): void
    {
        $mk = fn ($t) => DailyActivity::create(['deployment_id' => $this->dep->id, 'activity_date' => '2026-05-04', 'title' => $t, 'description' => 'd', 'status' => 'pending']);
        $one = $mk('one');
        $two = $mk('two');

        Sanctum::actingAs($this->stranger);
        $this->patchJson("/api/supervisor/activities/{$one->id}", ['status' => 'approved'])->assertStatus(404);

        Sanctum::actingAs($this->supB);
        $this->patchJson("/api/supervisor/activities/{$one->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame($this->supB->id, (int) $one->fresh()->reviewed_by); // who reviewed is still recorded

        Sanctum::actingAs($this->supA);
        $this->postJson('/api/supervisor/activities/approve', ['ids' => [$two->id]])->assertSuccessful();
        $this->assertSame('approved', $two->fresh()->status);
        $this->assertSame($this->supA->id, (int) $two->fresh()->reviewed_by);
    }

    public function test_tasks_are_shared_and_can_be_created_and_rated_by_either(): void
    {
        Sanctum::actingAs($this->supA);
        $this->postJson('/api/supervisor/tasks', [
            'deployment_ids' => [$this->dep->id], 'title' => 'Build report', 'priority' => 'medium',
        ])->assertOk();
        $task = Task::where('title', 'Build report')->firstOrFail();

        Sanctum::actingAs($this->supB);
        $this->assertContains($task->id, collect($this->getJson('/api/supervisor/tasks')->assertOk()->json('tasks'))->pluck('id')->all());
        $this->getJson("/api/supervisor/tasks/{$task->id}")->assertOk();
        $task->update(['status' => 'completed']);
        $this->postJson("/api/supervisor/tasks/{$task->id}/evaluate", ['rating' => 8])->assertOk();

        Sanctum::actingAs($this->stranger);
        $this->assertNotContains($task->id, collect($this->getJson('/api/supervisor/tasks')->json('tasks'))->pluck('id')->all());
        $this->getJson("/api/supervisor/tasks/{$task->id}")->assertStatus(404);
        $this->postJson('/api/supervisor/tasks', ['deployment_ids' => [$this->dep->id], 'title' => 'x', 'priority' => 'low'])->assertStatus(422);
    }

    public function test_either_supervisor_can_evaluate_and_a_stranger_cannot(): void
    {
        // Evaluations open once the internship is finished.
        $this->dep->update(['status' => 'completed']);
        $payload = ['deployment_id' => $this->dep->id, 'evaluation_date' => '2026-06-01', 'overall_score' => 90, 'remarks' => 'good'];
        Sanctum::actingAs($this->stranger);
        $this->postJson('/api/supervisor/evaluations/manual', $payload)->assertStatus(404);
        Sanctum::actingAs($this->supB);
        $this->postJson('/api/supervisor/evaluations/manual', $payload)->assertOk();
        Sanctum::actingAs($this->supA);
        $this->assertCount(1, $this->getJson('/api/supervisor/evaluations')->assertOk()->json('evaluations'));
        $this->getJson("/api/supervisor/interns/{$this->dep->id}/portfolio")->assertOk();
        Sanctum::actingAs($this->stranger);
        $this->getJson("/api/supervisor/interns/{$this->dep->id}/portfolio")->assertStatus(404);
    }

    public function test_notifications_go_to_every_active_supervisor_once(): void
    {
        $this->dep->notifySupervisors('attendance_logged', 'Attendance logged', 'x', '/supervisor/attendance');
        $this->assertSame(1, Notification::where('user_id', $this->supA->id)->where('type', 'attendance_logged')->count());
        $this->assertSame(1, Notification::where('user_id', $this->supB->id)->where('type', 'attendance_logged')->count());
        $this->assertSame(0, Notification::where('user_id', $this->stranger->id)->count());

        // An inactive supervisor is skipped.
        $this->supB->forceFill(['status' => 'inactive'])->save();
        Notification::query()->delete();
        InternshipDeployment::findOrFail($this->dep->id)->notifySupervisors('attendance_logged', 't', 'x', '/supervisor/attendance');
        $this->assertSame(1, Notification::count());
    }

    public function test_task_completed_notifies_both_supervisors(): void
    {
        $task = Task::create(['company_id' => $this->dep->company_id, 'assigned_by' => $this->supA->id, 'title' => 'T', 'priority' => 'low', 'status' => 'pending']);
        TaskAssignee::create(['task_id' => $task->id, 'deployment_id' => $this->dep->id, 'user_id' => $this->dep->intern_id]);
        $task->setStatus('completed');
        foreach ([$this->supA, $this->supB] as $sup) {
            $this->assertSame(1, Notification::where('user_id', $sup->id)->where('type', 'task_completed')->count());
        }
        $this->assertSame(0, Notification::where('user_id', $this->stranger->id)->count());
    }

    public function test_coordinator_flags_follow_the_company_not_the_deployment_column(): void
    {
        $this->dep->update(['status' => 'active', 'supervisor_id' => null]);
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $keys = collect($this->getJson('/api/coordinator/interns')->json('interns.0.attention'))->pluck('key')->all();
        $this->assertNotContains('no_supervisor', $keys);

        User::whereIn('id', [$this->supA->id, $this->supB->id])->update(['status' => 'inactive']);
        $keys = collect($this->getJson('/api/coordinator/interns')->json('interns.0.attention'))->pluck('key')->all();
        $this->assertContains('no_supervisor', $keys);
    }

    public function test_coordinator_forms_no_longer_need_or_set_a_supervisor(): void
    {
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $this->postJson('/api/coordinator/interns', [
            'first_name' => 'New', 'last_name' => 'Intern', 'email' => 'newintern@gmail.com', 'course' => 'BS IT',
            'company_id' => $this->dep->company_id, 'start_date' => '2026-10-01', 'supervisor_id' => $this->supA->id,
        ])->assertSuccessful();
        $created = InternshipDeployment::whereHas('intern', fn ($q) => $q->where('email', 'newintern@gmail.com'))->firstOrFail();
        $this->assertNull($created->supervisor_id);

        $this->patchJson("/api/coordinator/interns/{$created->id}", ['required_hours' => 300, 'start_date' => '2026-10-02', 'supervisor_id' => $this->supA->id])->assertOk();
        $this->assertNull($created->fresh()->supervisor_id);

        // Both supervisors count the same interns at their company.
        $rows = collect($this->getJson('/api/coordinator/supervisors')->json('supervisors'))->where('company_id', $this->dep->company_id)->values();
        $this->assertCount(2, $rows);
        $this->assertSame(2, $rows[0]['interns_count']);
        $this->assertSame(2, $rows[1]['interns_count']);
    }

    public function test_narrative_report_lists_the_companys_supervisors(): void
    {
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $name = $this->getJson("/api/coordinator/interns/{$this->dep->id}/narrative-report")->assertOk()->json('supervisor_name');
        $this->assertStringContainsString('Onyok Padilla', $name);
        $this->assertStringContainsString($this->supA->first_name, $name);
    }

    public function test_listing_does_not_query_supervisors_per_row(): void
    {
        for ($i = 0; $i < 3; $i++) {
            $u = User::create([
                'name' => "I$i X", 'email' => "i$i@internova.test", 'password' => bcrypt('p'), 'role_id' => Role::where('name', 'intern')->value('id'),
                'school_id' => $this->dep->school_id, 'first_name' => "I$i", 'last_name' => 'X', 'status' => 'active',
            ]);
            InternshipDeployment::create(['school_id' => $this->dep->school_id, 'intern_id' => $u->id, 'company_id' => $this->dep->company_id, 'coordinator_id' => $this->dep->coordinator_id, 'start_date' => '2026-05-01', 'required_hours' => 100, 'status' => 'active']);
        }
        Sanctum::actingAs($this->supB);
        $sql = [];
        DB::listen(function ($q) use (&$sql) {
            $sql[] = $q->sql;
        });
        $this->getJson('/api/supervisor/interns')->assertOk()->assertJsonCount(4, 'interns');
        $this->assertLessThanOrEqual(3, collect($sql)->filter(fn ($s) => str_contains($s, 'supervisor_profiles'))->count());
    }
}
