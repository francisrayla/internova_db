<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternshipDeployment;
use App\Models\PlanChangeRequest;
use App\Models\PlanInquiry;
use App\Models\School;
use App\Models\SupportTicket;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ONE definition of "finished" (status completed OR approved hours >= required hours) for every tile, filter and
 * count, and the per-role "needs attention" queue behind each dashboard.
 */
class DashboardQueueTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['status' => 'active', 'required_hours' => 8, 'start_date' => now()->subDays(20)->toDateString(), 'end_date' => now()->addDays(60)->toDateString()]);
    }

    private function as(string $email): User
    {
        $u = User::where('email', "{$email}@internova.test")->firstOrFail();
        Sanctum::actingAs($u);

        return $u;
    }

    /** An approved, completed 8-hour day, enough to meet the required 8 hours. */
    private function finishHours(?InternshipDeployment $d = null, string $daysAgo = '1'): void
    {
        $d ??= $this->dep;
        $in = now()->subDays((int) $daysAgo)->setTime(1, 0);
        Attendance::create(['deployment_id' => $d->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHours(8), 'status' => 'approved']);
    }

    // ---------------------------------------------------------------
    // The one definition of "completed"
    // ---------------------------------------------------------------

    public function test_enough_approved_hours_count_as_completed_for_coordinator_supervisor_and_dean(): void
    {
        $this->finishHours();

        $this->as('coordinator');
        $this->getJson('/api/coordinator/interns')->assertOk()
            ->assertJsonPath('interns.0.status', 'active')          // the stored status is untouched
            ->assertJsonPath('interns.0.display_status', 'completed')
            ->assertJsonPath('interns.0.is_finished', true)
            ->assertJsonPath('summary.completed', 1)
            ->assertJsonPath('summary.active', 0);
        $this->getJson('/api/coordinator/companies')->assertOk()
            ->assertJsonPath('companies.0.completed_interns_count', 1);
        $this->getJson('/api/coordinator/supervisors')->assertOk()
            ->assertJsonPath('supervisors.0.completed_interns_count', 1);

        $this->as('supervisor');
        $this->getJson('/api/supervisor/interns')->assertOk()
            ->assertJsonPath('interns.0.display_status', 'completed')
            ->assertJsonPath('interns.0.is_finished', true);
        $this->getJson('/api/supervisor/dashboard')->assertOk()
            ->assertJsonPath('summary.completed', 1)->assertJsonPath('summary.active', 0);

        $this->as('dean');
        $this->getJson('/api/dean/overview')->assertOk()
            ->assertJsonPath('progress.interns_completed', 1)
            ->assertJsonPath('progress.interns_active', 0)
            ->assertJsonPath('progress.groups.completed', 1);
    }

    public function test_status_completed_counts_as_finished_even_without_enough_hours(): void
    {
        $this->dep->update(['status' => 'completed']);

        $this->as('coordinator');
        $this->getJson('/api/coordinator/interns')->assertOk()->assertJsonPath('summary.completed', 1)->assertJsonPath('interns.0.is_finished', true);
        $this->as('dean');
        $this->getJson('/api/dean/overview')->assertOk()->assertJsonPath('progress.interns_completed', 1);
    }

    public function test_unfinished_intern_is_active_everywhere(): void
    {
        $this->as('coordinator');
        $this->getJson('/api/coordinator/interns')->assertOk()->assertJsonPath('summary.active', 1)->assertJsonPath('summary.completed', 0);
        $this->as('dean');
        $this->getJson('/api/dean/overview')->assertOk()->assertJsonPath('progress.interns_active', 1)->assertJsonPath('progress.interns_completed', 0);
    }

    // ---------------------------------------------------------------
    // Finished interns keep no red flags
    // ---------------------------------------------------------------

    public function test_finished_intern_is_not_flagged_for_no_clock_in_or_behind_hours(): void
    {
        // Hours done 10 days ago, nothing since: an active intern would have raised "no clock-in".
        $this->finishHours(null, '10');

        $this->as('coordinator');
        $row = $this->getJson('/api/coordinator/interns')->assertOk()->json('interns.0');
        $this->assertSame([], $row['attention']);
        $this->getJson('/api/coordinator/interns')->assertJsonPath('summary.needs_attention', 0);

        $this->as('dean');
        $alerts = collect($this->getJson('/api/dean/overview')->assertOk()->json('alerts'))->pluck('key')->all();
        $this->assertNotContains('no_clock_in', $alerts);
        $this->assertNotContains('behind_hours', $alerts);
        $this->assertNotContains('no_supervisor', $alerts);
    }

    public function test_pending_account_is_not_flagged_as_absent(): void
    {
        $this->dep->intern->forceFill(['status' => 'pending_activation'])->save();

        $this->as('dean');
        $res = $this->getJson('/api/dean/overview')->assertOk();
        $this->assertNotContains('no_clock_in', collect($res->json('alerts'))->pluck('key')->all());
        $res->assertJsonPath('progress.interns_active', 0)->assertJsonPath('progress.interns_pending_accounts', 1);
    }

    public function test_unfinished_intern_without_clock_ins_is_still_flagged(): void
    {
        $this->as('coordinator');
        $keys = collect($this->getJson('/api/coordinator/interns')->assertOk()->json('interns.0.attention'))->pluck('key')->all();
        $this->assertContains('no_clock_in', $keys);
        $this->as('dean');
        $alerts = collect($this->getJson('/api/dean/overview')->json('alerts'))->pluck('key')->all();
        $this->assertContains('no_clock_in', $alerts);
    }

    // ---------------------------------------------------------------
    // Average hours
    // ---------------------------------------------------------------

    public function test_average_hours_includes_finished_interns_at_their_real_percent_and_skips_pending_accounts(): void
    {
        $this->finishHours(); // 100%
        $this->dep->update(['required_hours' => 8]);
        $this->as('coordinator');
        $this->getJson('/api/coordinator/interns')->assertJsonPath('summary.average_hours_pct', 100)->assertJsonPath('summary.on_list', 1);
        $this->getJson('/api/coordinator/dashboard')->assertOk()->assertJsonPath('summary.average_hours_pct', 100);
        $this->as('supervisor');
        $this->getJson('/api/supervisor/dashboard')->assertJsonPath('summary.average_hours_pct', 100);
        $this->as('dean');
        $this->getJson('/api/dean/overview')->assertJsonPath('progress.average_hours_pct', 100);

        // An intern who has not set up the account (and so has no hours): shown as pending, not part of the average.
        Attendance::query()->delete();
        $this->dep->intern->forceFill(['status' => 'pending_activation'])->save();
        $this->dep->update(['status' => 'active']);
        $this->as('coordinator');
        $this->getJson('/api/coordinator/dashboard')->assertJsonPath('summary.invitation_pending', 1)->assertJsonPath('summary.on_list', 0);
    }

    // ---------------------------------------------------------------
    // Supervisor queue
    // ---------------------------------------------------------------

    private function queue(string $url): array
    {
        return collect($this->getJson($url)->assertOk()->json('queue'))->keyBy('key')->all();
    }

    public function test_supervisor_queue_counts_unchecked_red_flags_and_links_to_the_filtered_list(): void
    {
        $sup = $this->as('supervisor');
        $in = now()->subDay()->setTime(20, 0); // odd hour (after 17:00 Manila is derived on save)
        $flagged = Attendance::create(['deployment_id' => $this->dep->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHour(), 'status' => 'approved', 'clock_in_odd_hours' => true]);
        $this->assertTrue($flagged->fresh()->red_flag);

        $res = $this->getJson('/api/supervisor/dashboard')->assertOk()->assertJsonPath('summary.red_flags_unchecked', 1);
        $q = collect($res->json('queue'))->keyBy('key');
        $this->assertSame(1, $q['red_flags']['count']);
        $this->assertSame('red', $q['red_flags']['tone']);
        $this->assertSame('/supervisor/attendance?flag=unchecked', $q['red_flags']['href']);

        $flagged->update(['red_flag_checked_by' => $sup->id, 'red_flag_checked_at' => now()]);
        $res = $this->getJson('/api/supervisor/dashboard')->assertJsonPath('summary.red_flags_unchecked', 0);
        $this->assertArrayNotHasKey('red_flags', collect($res->json('queue'))->keyBy('key')->all());
    }

    public function test_supervisor_queue_auto_closed_shifts_activities_and_ready_to_evaluate(): void
    {
        $this->as('supervisor');
        $in = now()->subDays(2)->setTime(1, 0);
        Attendance::create(['deployment_id' => $this->dep->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHours(8), 'status' => 'approved', 'auto_clocked_out' => true]);
        DailyActivity::create(['deployment_id' => $this->dep->id, 'activity_date' => now()->toDateString(), 'title' => 'Did a thing', 'description' => 'x', 'status' => 'pending']);

        $q = $this->queue('/api/supervisor/dashboard');
        $this->assertSame(1, $q['auto_closed']['count']);
        $this->assertSame(1, $q['activities']['count']);
        $this->assertSame('/supervisor/activities?status=pending', $q['activities']['href']);
        // 8 required hours were rendered by that shift: ready to evaluate, and it links to that intern.
        $this->assertSame(1, $q['ready_to_evaluate']['count']);
        $this->assertSame('/supervisor/evaluations/new?intern=' . $this->dep->id, $q['ready_to_evaluate']['href']);

        Evaluation::create(['deployment_id' => $this->dep->id, 'evaluator_id' => User::where('email', 'supervisor@internova.test')->value('id'), 'evaluation_date' => now()->toDateString(), 'overall_score' => 90, 'status' => 'submitted']);
        $this->assertArrayNotHasKey('ready_to_evaluate', $this->queue('/api/supervisor/dashboard'));
    }

    public function test_supervisor_queue_is_scoped_to_their_company(): void
    {
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'ZZ1', 'company_name' => 'Other Co', 'status' => 'active']);
        $d2 = InternshipDeployment::create(['school_id' => $this->dep->school_id, 'intern_id' => $this->dep->intern_id, 'company_id' => $other->id,
            'start_date' => now()->subDays(5)->toDateString(), 'end_date' => now()->addDays(30)->toDateString(), 'required_hours' => 8, 'status' => 'active']);
        $in = now()->subDay()->setTime(1, 0);
        Attendance::create(['deployment_id' => $d2->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHours(8), 'status' => 'approved', 'auto_clocked_out' => true, 'clock_in_odd_hours' => true]);

        $this->as('supervisor');
        $res = $this->getJson('/api/supervisor/dashboard')->assertOk()->assertJsonPath('summary.red_flags_unchecked', 0);
        $keys = collect($res->json('queue'))->pluck('key')->all();
        $this->assertNotContains('auto_closed', $keys);
        $this->assertNotContains('ready_to_evaluate', $keys);
    }

    // ---------------------------------------------------------------
    // Coordinator queue
    // ---------------------------------------------------------------

    public function test_coordinator_queue_items_have_counts_and_links(): void
    {
        $company = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'NS1', 'company_name' => 'No Sup Inc', 'status' => 'active']);
        $pendingIntern = User::factory()->create(['school_id' => $this->dep->school_id, 'role_id' => $this->dep->intern->role_id, 'status' => 'pending_activation', 'password' => null]);
        InternshipDeployment::create(['school_id' => $this->dep->school_id, 'intern_id' => $pendingIntern->id, 'company_id' => $company->id,
            'start_date' => now()->toDateString(), 'end_date' => now()->addDays(60)->toDateString(), 'required_hours' => 100, 'status' => 'active']);
        Document::create(['deployment_id' => $this->dep->id, 'uploaded_by' => $this->dep->intern_id, 'document_type' => 'Resume', 'file_name' => 'r.pdf', 'file_path' => 'x/r.pdf', 'status' => 'pending']);
        $this->finishHours();

        $this->as('coordinator');
        $res = $this->getJson('/api/coordinator/dashboard')->assertOk()
            ->assertJsonPath('summary.completed', 1)->assertJsonPath('summary.invitation_pending', 1);
        $q = collect($res->json('queue'))->keyBy('key');
        $this->assertSame('/coordinator/interns/pending', $q['pending_accounts']['href']);
        $this->assertSame(1, $q['pending_accounts']['count']);
        $this->assertSame(1, $q['companies_no_supervisor']['count']);
        $this->assertSame('/coordinator/companies', $q['companies_no_supervisor']['href']);
        $this->assertSame(1, $q['documents']['count']);
        $this->assertSame(1, $q['finished']['count']);
        $this->assertStringContainsString('no evaluation', $q['finished']['detail']);
        $this->assertSame('/coordinator/interns?filter=completed', $q['finished']['href']);
        // The finished intern is not "needing attention" even though they have not clocked in lately.
        $this->assertArrayNotHasKey('attention', $q->all());
    }

    public function test_coordinator_queue_is_empty_when_nothing_needs_them(): void
    {
        $this->dep->update(['start_date' => now()->toDateString()]);
        $in = now()->setTime(1, 0)->subHours(0);
        Attendance::create(['deployment_id' => $this->dep->id, 'attendance_date' => now()->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHours(1), 'status' => 'approved']);
        $this->dep->update(['required_hours' => 480]);
        $this->as('coordinator');
        $this->assertSame([], $this->getJson('/api/coordinator/dashboard')->assertOk()->json('queue'));
    }

    // ---------------------------------------------------------------
    // Intern next step
    // ---------------------------------------------------------------

    public function test_intern_next_step_before_and_after_finishing(): void
    {
        $this->as('intern');
        $q = $this->queue('/api/intern/dashboard');
        $this->assertSame('Clock in for today', $q['clock_in']['title']);
        $this->assertSame('/intern/attendance', $q['clock_in']['href']);
        $this->assertStringContainsString('8 of 8 hours left', $q['clock_in']['detail']);

        $this->finishHours();
        $res = $this->getJson('/api/intern/dashboard')->assertOk()->assertJsonPath('is_finished', true);
        $q = collect($res->json('queue'))->keyBy('key');
        $this->assertArrayNotHasKey('clock_in', $q->all());
        $this->assertSame('green', $q['finished']['tone']);
        $this->assertSame('/intern/evaluations', $q['evaluation']['href']);
        $this->assertStringContainsString('Waiting for your supervisor', $q['evaluation']['title']);

        Evaluation::create(['deployment_id' => $this->dep->id, 'evaluator_id' => User::where('email', 'supervisor@internova.test')->value('id'), 'evaluation_date' => now()->toDateString(), 'overall_score' => 88, 'status' => 'submitted']);
        $q = $this->queue('/api/intern/dashboard');
        $this->assertSame('You received your evaluation', $q['evaluation']['title']);
    }

    public function test_intern_summary_marks_finished_and_queue_flags_late_tasks(): void
    {
        $intern = $this->as('intern');
        $this->finishHours();
        $this->getJson('/api/intern/profile-summary')->assertOk()->assertJsonPath('is_finished', true);

        $task = Task::create(['company_id' => $this->dep->company_id, 'assigned_by' => User::where('email', 'supervisor@internova.test')->value('id'), 'title' => 'Late', 'priority' => 'low', 'status' => 'pending', 'due_date' => now()->subDays(2)->toDateString()]);
        TaskAssignee::create(['task_id' => $task->id, 'deployment_id' => $this->dep->id, 'user_id' => $intern->id]);
        $q = $this->queue('/api/intern/dashboard');
        $this->assertSame(1, $q['tasks_overdue']['count']);
        $this->assertSame('red', $q['tasks_overdue']['tone']);
    }

    // ---------------------------------------------------------------
    // Super Admin queue
    // ---------------------------------------------------------------

    public function test_super_admin_queue_lists_what_waits_for_them_and_hides_zeros(): void
    {
        $this->as('superadmin');
        $this->assertSame([], $this->getJson('/api/superadmin/dashboard')->assertOk()->json('queue'));

        PlanInquiry::create(['school_name' => 'New U', 'contact_person' => 'A', 'email' => 'a@gmail.com', 'status' => 'new']);
        PlanChangeRequest::create(['school_id' => $this->dep->school_id, 'requested_plan' => 'Pro', 'requested_billing_period' => 'yearly', 'status' => 'pending']);
        SupportTicket::create(['school_id' => $this->dep->school_id, 'coordinator_id' => User::where('email', 'coordinator@internova.test')->value('id'), 'subject' => 'Help', 'category' => 'General', 'status' => 'Open']);

        $q = $this->queue('/api/superadmin/dashboard');
        $this->assertSame(1, $q['inquiries']['count']);
        $this->assertSame('/superadmin/inquiries', $q['inquiries']['href']);
        $this->assertSame(1, $q['plan_changes']['count']);
        $this->assertSame(1, $q['tickets']['count']);
        $this->assertSame('/superadmin/support', $q['tickets']['href']);
        $this->assertArrayNotHasKey('payments', $q);
    }

    public function test_super_admin_queue_flags_payment_proofs_and_expiring_subscriptions(): void
    {
        $school = School::findOrFail($this->dep->school_id);
        $sub = $school->subscriptions()->latest('id')->first();
        $this->assertNotNull($sub, 'the seeder gives the demo school a subscription');
        $sub->forceFill(['status' => 'active', 'end_date' => now()->addDays(5), 'payment_status' => 'pending_verification'])->save();

        $this->as('superadmin');
        $q = $this->queue('/api/superadmin/dashboard');
        $this->assertSame(1, $q['payments']['count']);
        $this->assertSame("/superadmin/schools?highlight={$school->id}", $q['payments']['href']);
        $this->assertSame(1, $q['expiring']['count']);

        $sub->forceFill(['end_date' => now()->addDays(40), 'payment_status' => 'paid'])->save();
        $keys = collect($this->getJson('/api/superadmin/dashboard')->json('queue'))->pluck('key')->all();
        $this->assertNotContains('payments', $keys);
        $this->assertNotContains('expiring', $keys);
    }

    public function test_dashboard_endpoints_are_role_protected(): void
    {
        $this->as('intern');
        $this->getJson('/api/coordinator/dashboard')->assertForbidden();
        $this->getJson('/api/supervisor/dashboard')->assertForbidden();
        $this->getJson('/api/superadmin/dashboard')->assertForbidden();
        $this->as('coordinator');
        $this->getJson('/api/intern/dashboard')->assertForbidden();
    }
}
