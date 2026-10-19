<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\DeploymentTransfer;
use App\Models\Document;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\User;
use App\Services\DeploymentMergeBackfill;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DeploymentTransferTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private Company $abc;
    private Company $other;
    private User $otherSup;

    protected function setUp(): void
    {
        parent::setUp();
        // Fixed "today": a move date can be at most today, and these tests move on 2026-10-20.
        $this->travelTo(\Illuminate\Support\Carbon::parse('2026-10-21 09:00:00'));
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['start_date' => '2026-04-20', 'end_date' => '2026-12-31']);
        $this->abc = Company::findOrFail($this->dep->company_id);
        $this->other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-2', 'company_name' => 'internova', 'status' => 'active']);
        $this->otherSup = User::create([
            'name' => 'Ana Reyes', 'email' => 'ana@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $this->otherSup->id, 'school_id' => $this->dep->school_id, 'company_id' => $this->other->id]);
    }

    private function coordinator(): User
    {
        return User::where('email', 'coordinator@internova.test')->firstOrFail();
    }

    private function attend(int $deploymentId, string $day, int $hours = 8): void
    {
        Attendance::create([
            'deployment_id' => $deploymentId, 'attendance_date' => $day,
            'clock_in' => "{$day} 08:00:00", 'clock_out' => Carbon::parse("{$day} 08:00:00")->addHours($hours),
            'status' => 'approved',
        ]);
    }

    private function reassign(array $extra = [])
    {
        return $this->postJson("/api/coordinator/interns/{$this->dep->id}/reassign", $extra + [
            'company_id' => $this->other->id, 'supervisor_id' => $this->otherSup->id, 'transferred_on' => '2026-10-20',
        ]);
    }

    public function test_reassign_edits_the_same_deployment_and_records_the_transfer(): void
    {
        $this->attend($this->dep->id, '2026-05-04');
        $this->attend($this->dep->id, '2026-05-05');
        $before = InternshipDeployment::count();
        Sanctum::actingAs($this->coordinator());

        $this->reassign()->assertOk()->assertJsonPath('deployment_id', $this->dep->id);

        $this->assertSame($before, InternshipDeployment::count());
        $d = $this->dep->fresh();
        $this->assertSame($this->other->id, $d->company_id);
        $this->assertNull($d->supervisor_id);
        $this->assertSame('active', $d->status);
        $this->assertSame('2026-04-20', $d->start_date->toDateString()); // original start kept
        $this->assertSame(480, (int) $d->required_hours);                 // total stays
        $this->assertSame(2, Attendance::where('deployment_id', $d->id)->count());

        $t = DeploymentTransfer::firstOrFail();
        $this->assertSame($this->abc->id, $t->from_company_id);
        $this->assertNull($t->from_supervisor_id);
        $this->assertSame($this->other->id, $t->to_company_id);
        $this->assertSame('2026-10-20', $t->transferred_on->toDateString());
        $this->assertEquals(16.0, $t->approved_hours_at_transfer);
        $this->assertTrue(ActivityLog::where('action', 'Reassigned intern')->exists());

        // One row everywhere, with the "Moved from" note; hours carry over.
        $rows = $this->getJson('/api/coordinator/interns')->assertOk()->json('interns');
        $this->assertCount(1, $rows);
        $this->assertSame('internova', $rows[0]['company_name']);
        $this->assertSame('ABC Technologies', $rows[0]['moved_from']);
        $this->assertEquals(16.0, $rows[0]['hours_completed']);
        $this->getJson('/api/coordinator/interns')->assertJsonPath('summary.completed', 0)->assertJsonPath('summary.total', 1);
    }

    public function test_reassign_rejects_same_company_and_dates_before_start(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->reassign(['company_id' => $this->abc->id, 'supervisor_id' => null])->assertStatus(422);
        $this->reassign(['transferred_on' => '2026-01-01'])->assertStatus(422);
        $this->assertSame(0, DeploymentTransfer::count());
    }

    public function test_old_company_hides_the_intern_but_lists_transferred_out(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->reassign()->assertOk();

        $old = $this->getJson("/api/coordinator/companies/{$this->abc->id}")->assertOk();
        $this->assertCount(0, $old->json('interns'));
        $old->assertJsonPath('summary.total', 0);
        $this->assertCount(1, $old->json('transferred_out'));
        $old->assertJsonPath('transferred_out.0.transferred_to', 'internova');

        $new = $this->getJson("/api/coordinator/companies/{$this->other->id}")->assertOk();
        $this->assertCount(1, $new->json('interns'));
        $this->assertCount(0, $new->json('transferred_out'));

        // A company with transfer history cannot be deleted.
        $this->deleteJson("/api/coordinator/companies/{$this->abc->id}")->assertStatus(422);
    }

    public function test_supervisor_scoping_follows_the_move(): void
    {
        $old = SupervisorProfile::where('company_id', $this->abc->id)->firstOrFail()->user;
        Sanctum::actingAs($this->coordinator());
        $this->reassign()->assertOk();

        Sanctum::actingAs($old);
        $this->assertCount(0, $this->getJson('/api/supervisor/interns')->assertOk()->json('interns'));
        Sanctum::actingAs($this->otherSup);
        $this->assertCount(1, $this->getJson('/api/supervisor/interns')->assertOk()->json('interns'));
    }

    public function test_history_is_available_to_coordinator_dean_and_intern(): void
    {
        $this->attend($this->dep->id, '2026-05-04');
        $this->attend($this->dep->id, '2026-10-21', 4);
        Sanctum::actingAs($this->coordinator());
        $this->reassign()->assertOk();

        $h = $this->getJson("/api/coordinator/interns/{$this->dep->id}/report")->assertOk()->json('deployment_history');
        $this->assertCount(2, $h);
        $this->assertSame('ABC Technologies', $h[0]['company_name']);
        $this->assertSame('Jose Dela Cruz', $h[0]['supervisor_name']);
        $this->assertSame('2026-10-19', $h[0]['end_date']);
        $this->assertEquals(8.0, $h[0]['hours']);
        $this->assertSame('internova', $h[1]['company_name']);
        $this->assertSame('Ana Reyes', $h[1]['supervisor_name']);
        $this->assertSame('2026-10-20', $h[1]['start_date']);
        $this->assertEquals(4.0, $h[1]['hours']);
        $this->assertTrue($h[1]['is_current']);
        $this->assertStringContainsString('present', $h[1]['range']);

        Sanctum::actingAs(User::where('email', 'dean@internova.test')->firstOrFail());
        $this->assertCount(2, $this->getJson("/api/dean/interns/{$this->dep->id}")->assertOk()->json('history'));
        $list = $this->getJson('/api/dean/interns')->assertOk();
        $this->assertSame('ABC Technologies', collect($list->json('interns'))->first()['moved_from']);

        Sanctum::actingAs(User::where('email', 'intern@internova.test')->firstOrFail());
        $this->assertCount(2, $this->getJson('/api/intern/profile-summary')->assertOk()->json('history'));
    }

    public function test_narrative_report_shows_company_per_date_and_previous_company(): void
    {
        $this->attend($this->dep->id, '2026-05-04');
        $this->attend($this->dep->id, '2026-10-21');
        Sanctum::actingAs($this->coordinator());
        $this->reassign()->assertOk();

        $r = $this->getJson("/api/coordinator/interns/{$this->dep->id}/narrative-report")->assertOk();
        $r->assertJsonPath('company.name', 'internova');
        $r->assertJsonPath('ledger.multi_company', true);
        $r->assertJsonPath('ledger.rows.0.company', 'ABC Technologies');
        $r->assertJsonPath('ledger.rows.1.company', 'internova');
        $r->assertJsonPath('ledger.total_hours', 16);
        $r->assertJsonPath('journal.0.company', 'ABC Technologies');
        $r->assertJsonPath('journal.1.company', 'internova');
        $this->assertStringStartsWith('Previously deployed at ABC Technologies, Apr 20 – Oct 19, 2026', $r->json('deployment.previous.0.label'));

        $this->get("/api/coordinator/interns/{$this->dep->id}/narrative-report/docx")->assertOk();
    }

    public function test_report_without_transfers_is_unchanged(): void
    {
        $this->attend($this->dep->id, '2026-05-04');
        Sanctum::actingAs($this->coordinator());
        $r = $this->getJson("/api/coordinator/interns/{$this->dep->id}/narrative-report")->assertOk();
        $r->assertJsonPath('ledger.multi_company', false)->assertJsonPath('ledger.rows.0.company', null)->assertJsonPath('deployment.previous', []);
        $this->assertSame([], $this->getJson("/api/coordinator/interns/{$this->dep->id}/report")->json('deployment_history'));
    }

    public function test_listing_queries_do_not_grow_with_transfers(): void
    {
        Sanctum::actingAs($this->coordinator());
        $count = function () {
            $n = 0;
            DB::listen(function () use (&$n) { $n++; });
            $this->getJson('/api/coordinator/interns')->assertOk();

            return $n;
        };
        $this->reassign()->assertOk();
        $base = $count();
        $this->assertSame($base, $count());
    }

    // ---------------------------------------------------------------
    // Data fix for reassignments made the old way
    // ---------------------------------------------------------------

    /** Builds what the old reassignIntern() left behind: A closed as completed, B created. */
    private function oldStyleReassignment(Carbon $at, bool $log = true, bool $closeAtSameTime = true): InternshipDeployment
    {
        $a = $this->dep;
        $this->attend($a->id, '2026-05-04');
        $a->forceFill(['status' => 'completed'])->save();
        DB::table('internship_deployments')->where('id', $a->id)->update(['updated_at' => $closeAtSameTime ? $at : $at->copy()->subDays(30)]);

        $b = InternshipDeployment::create([
            'school_id' => $a->school_id, 'intern_id' => $a->intern_id, 'company_id' => $this->other->id,
            'supervisor_id' => $this->otherSup->id, 'coordinator_id' => $a->coordinator_id,
            'start_date' => '2026-10-20', 'required_hours' => 500, 'status' => 'active',
        ]);
        DB::table('internship_deployments')->where('id', $b->id)->update(['created_at' => $at, 'updated_at' => $at]);

        if ($log) {
            $row = ActivityLog::create([
                'school_id' => $a->school_id, 'module' => 'Interns', 'action' => 'Reassigned intern',
                'description' => "{$a->intern->name} moved from ABC Technologies to internova.",
            ]);
            DB::table('activity_logs')->where('id', $row->id)->update(['created_at' => $at->copy()->addSeconds(1)]);
        }

        return $b->fresh();
    }

    public function test_backfill_merges_old_style_reassignment_into_the_original(): void
    {
        $a = $this->dep;
        $at = Carbon::parse('2026-10-06 09:00:00');
        $b = $this->oldStyleReassignment($at);
        $this->attend($b->id, '2026-10-21');
        DailyActivity::create(['deployment_id' => $b->id, 'activity_date' => '2026-10-21', 'title' => 'New job', 'description' => 'x', 'status' => 'approved']);
        Document::create(['deployment_id' => $b->id, 'uploaded_by' => $a->intern_id, 'document_type' => 'Resume', 'file_name' => 'r.pdf', 'file_path' => 'documents/r.pdf', 'status' => 'pending']);
        $task = Task::create(['company_id' => $this->other->id, 'assigned_by' => $this->otherSup->id, 'title' => 'T2', 'status' => 'pending', 'priority' => 'low']);
        TaskAssignee::create(['task_id' => $task->id, 'deployment_id' => $b->id, 'user_id' => $a->intern_id]);
        Notification::create(['audience_role' => 'coordinator', 'school_id' => $a->school_id, 'type' => 'x', 'title' => 'x', 'link' => "/coordinator/interns/{$b->id}/report"]);

        $pretend = DeploymentMergeBackfill::run(true);
        $this->assertSame('would merge', $pretend[0]['action']);
        $this->assertSame(2, InternshipDeployment::count()); // pretend writes nothing

        $report = DeploymentMergeBackfill::run();
        $this->assertSame('merged', $report[0]['action']);
        $this->assertSame(1, InternshipDeployment::count());
        $m = $a->fresh();
        $this->assertSame($this->other->id, $m->company_id);
        $this->assertSame($this->otherSup->id, $m->supervisor_id);
        $this->assertSame('active', $m->status);
        $this->assertSame(500, (int) $m->required_hours);
        $this->assertSame('2026-04-20', $m->start_date->toDateString());
        $this->assertSame(2, Attendance::where('deployment_id', $m->id)->count());
        $this->assertSame(1, DailyActivity::where('deployment_id', $m->id)->count());
        $this->assertSame(1, Document::where('deployment_id', $m->id)->count());
        $this->assertSame(2, TaskAssignee::where('deployment_id', $m->id)->count()); // seeded task + moved task
        $this->assertSame("/coordinator/interns/{$m->id}/report", Notification::firstOrFail()->link);
        $t = DeploymentTransfer::firstOrFail();
        $this->assertSame($this->abc->id, $t->from_company_id);
        $this->assertSame('2026-10-20', $t->transferred_on->toDateString());
        $this->assertEquals(8.0, $t->approved_hours_at_transfer);

        $this->assertSame([], DeploymentMergeBackfill::run()); // idempotent
        $this->assertSame(1, DeploymentTransfer::count());
    }

    public function test_backfill_skips_what_it_cannot_prove(): void
    {
        // Completed long ago, no matching log, newer deployment created much later: a real completion.
        $this->oldStyleReassignment(Carbon::parse('2026-10-06 09:00:00'), log: false, closeAtSameTime: false);

        $report = DeploymentMergeBackfill::run();
        $this->assertSame('skipped', $report[0]['action']);
        $this->assertSame(2, InternshipDeployment::count());
        $this->assertSame(0, DeploymentTransfer::count());
    }

    public function test_backfill_accepts_log_evidence_alone(): void
    {
        $this->oldStyleReassignment(Carbon::parse('2026-10-06 09:00:00'), log: true, closeAtSameTime: false);
        $this->assertSame('merged', DeploymentMergeBackfill::run()[0]['action']);
        $this->assertSame(1, InternshipDeployment::count());
    }

    public function test_the_move_date_is_between_the_last_move_and_today(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->reassign(['transferred_on' => '2026-10-22'])->assertStatus(422)->assertJsonValidationErrors('transferred_on');
        $this->reassign(['transferred_on' => '2031-01-01'])->assertStatus(422);
        $this->assertSame(0, DeploymentTransfer::count());

        $this->reassign(['transferred_on' => '2026-10-15'])->assertOk();

        // Moving back to the first company cannot be dated before that move.
        $back = fn (string $on) => $this->postJson("/api/coordinator/interns/{$this->dep->id}/reassign", ['company_id' => $this->abc->id, 'transferred_on' => $on]);
        $back('2026-10-14')->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'last move (Oct 15, 2026)'));
        $back('2026-10-21')->assertOk();
        $this->assertSame(2, DeploymentTransfer::count());
    }

    public function test_a_completed_or_inactive_internship_is_not_moved(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->dep->update(['status' => 'completed']);
        $this->reassign()->assertStatus(422)->assertJsonPath('message', 'This internship is completed, so the intern cannot be moved to another company.');

        $this->dep->update(['status' => 'inactive']);
        $this->reassign()->assertStatus(422)->assertJsonPath('message', 'This internship is inactive, so the intern cannot be moved to another company.');
        $this->assertSame(0, DeploymentTransfer::count());
    }
}
