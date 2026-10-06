<?php

namespace Tests\Feature;

use App\Mail\DeanWeeklySummary;
use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\DeanFeedback;
use App\Models\DeanProfile;
use App\Models\Document;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\NarrativeTemplate;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use App\Services\ActivityLogService;
use App\Services\DeanWeeklySummaryService;
use App\Services\InternMonitoringService as S;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Dean monitoring upgrades: status groups, projection, calendar, scorecard, checklist, chart, feedback threads, weekly email, report. */
class DeanInsightsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
        Carbon::setTestNow('2026-10-07 10:00:00'); // a Wednesday
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(string $email): User
    {
        return User::where('email', $email)->first();
    }

    private function dean(): User
    {
        return $this->user('dean@internova.test');
    }

    private function deployment(): InternshipDeployment
    {
        return InternshipDeployment::firstOrFail();
    }

    private function otherSchool(): array
    {
        $school = School::create(['school_code' => 'OTHER-1', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        $mk = fn (string $role, string $email) => User::create([
            'name' => "Other {$role}", 'email' => $email, 'password' => bcrypt('password'),
            'role_id' => Role::where('name', $role)->value('id'), 'school_id' => $school->id,
            'first_name' => 'Other', 'last_name' => ucfirst($role), 'status' => 'active', 'email_verified_at' => now(),
        ]);
        $dean = $mk('dean', 'otherdean@internova.test');
        DeanProfile::create(['user_id' => $dean->id, 'school_id' => $school->id, 'position' => 'Dean']);

        return [$school, $dean, $mk('coordinator', 'othercoord@internova.test')];
    }

    private function log(Document|ActivityLog $m, array $attrs): void
    {
        $m->timestamps = false;
        $m->forceFill($attrs)->save();
    }

    // ------------------------------------------------------------ status groups

    public function test_status_group_rules(): void
    {
        $f = fn (string $k) => ['key' => $k, 'level' => 'amber', 'label' => $k];
        $ok = ['late' => false];

        $this->assertSame('on_track', S::classify('active', false, [], 0, $ok)['group']);
        $this->assertSame('needs_attention', S::classify('active', false, [$f('behind_hours')], 0, $ok)['group']);
        $this->assertSame('at_risk', S::classify('active', false, [$f('behind_hours'), $f('missing_documents')], 0, $ok)['group']);
        $this->assertSame('at_risk', S::classify('active', false, [], 0, ['late' => true])['group']);
        $this->assertSame('needs_attention', S::classify('active', false, [$f('no_clock_in')], 4, $ok)['group']);
        $this->assertSame('at_risk', S::classify('active', false, [$f('no_clock_in')], 5, $ok)['group']);
        $this->assertSame('completed', S::classify('completed', false, [$f('a'), $f('b')], 9, ['late' => true])['group']);
        $this->assertSame('completed', S::classify('active', true, [$f('a')], 0, $ok)['group']);
        $this->assertSame('inactive', S::classify('inactive', false, [], 0, $ok)['group']);
    }

    public function test_interns_endpoint_groups_orders_and_filters(): void
    {
        $base = $this->deployment();
        // The seeded intern started a month ago and never clocked in: at risk.
        $u = User::create(['name' => 'Fresh Intern', 'email' => 'fresh@internova.test', 'password' => bcrypt('x'), 'role_id' => $base->intern->role_id, 'school_id' => $base->school_id, 'first_name' => 'Fresh', 'last_name' => 'Intern', 'status' => 'active']);
        InternshipDeployment::create(['school_id' => $base->school_id, 'intern_id' => $u->id, 'company_id' => $base->company_id, 'supervisor_id' => $base->supervisor_id, 'start_date' => now()->toDateString(), 'end_date' => now()->addMonths(3)->toDateString(), 'required_hours' => 480, 'status' => 'active']);
        $u2 = User::create(['name' => 'Done Intern', 'email' => 'done@internova.test', 'password' => bcrypt('x'), 'role_id' => $base->intern->role_id, 'school_id' => $base->school_id, 'first_name' => 'Done', 'last_name' => 'Intern', 'status' => 'active']);
        InternshipDeployment::create(['school_id' => $base->school_id, 'intern_id' => $u2->id, 'company_id' => $base->company_id, 'supervisor_id' => $base->supervisor_id, 'start_date' => now()->subMonths(5)->toDateString(), 'end_date' => now()->subMonth()->toDateString(), 'required_hours' => 480, 'status' => 'completed']);

        Sanctum::actingAs($this->dean());
        $res = $this->getJson('/api/dean/interns')->assertOk();
        $this->assertSame(['at_risk', 'on_track', 'completed'], collect($res->json('interns'))->pluck('status_group')->all());
        $this->assertSame(['at_risk' => 1, 'needs_attention' => 0, 'on_track' => 1, 'completed' => 1, 'total' => 3], $res->json('summary'));
        $this->assertSame('At risk', $res->json('interns.0.status_group_label'));
        $this->assertNotEmpty($res->json('interns.0.status_reasons'));

        $this->getJson('/api/dean/interns?group=completed')->assertJsonCount(1, 'interns')->assertJsonPath('summary.total', 3);
        $this->getJson('/api/dean/overview')->assertOk()->assertJsonPath('progress.groups.at_risk', 1)->assertJsonPath('progress.groups.completed', 1);
    }

    public function test_behind_on_hours_counts_working_days_not_calendar_days(): void
    {
        $this->assertSame(5, S::countWeekdays(Carbon::parse('2026-10-05'), Carbon::parse('2026-10-11')));
        $this->assertSame(2, S::countWeekdays(Carbon::parse('2026-10-03'), Carbon::parse('2026-10-06'))); // Sat..Tue
        $this->assertSame(22, S::countWeekdays(Carbon::parse('2026-09-07'), Carbon::parse('2026-10-06')));

        $d = $this->deployment();
        $d->update(['start_date' => '2026-09-07', 'end_date' => '2026-10-30', 'required_hours' => 400]);
        Sanctum::actingAs($this->dean());
        $row = $this->getJson('/api/dean/interns')->json('interns.0');
        // 22 of 40 working days gone = 55% (calendar days would say 57%).
        $this->assertSame(55, $row['elapsed_pct']);
    }

    // ------------------------------------------------------------ projection

    private function hoursMap(): array
    {
        $map = [];
        for ($d = Carbon::parse('2026-09-21'); $d->lte(Carbon::parse('2026-10-06')); $d->addDay()) {
            if ($d->isWeekday()) {
                $map[$d->toDateString()] = 4.0;
            }
        }

        return $map;
    }

    public function test_projection_uses_recent_pace_in_working_days(): void
    {
        $today = Carbon::parse('2026-10-07');
        $map = $this->hoursMap(); // 12 days x 4h = 48h, pace over the last 3 weeks = 48 / 15 = 3.2 h per working day

        $p = S::project('active', Carbon::parse('2026-09-14'), Carbon::parse('2026-10-23'), 100, 48.0, $map, $today);
        $this->assertSame('projected', $p['state']);
        $this->assertSame(3.2, $p['pace_hours_per_day']);
        // 52h left / 3.2 = 17 working days after Wed Oct 7 = Fri Oct 30.
        $this->assertSame('2026-10-30', $p['finish_date']);
        $this->assertTrue(Carbon::parse($p['finish_date'])->isWeekday());
        $this->assertTrue($p['late']);
        $this->assertSame(7, $p['days_vs_end']);
        $this->assertSame('On pace to finish Oct 30', $p['label']);
        $this->assertSame('7 days after the end date', $p['note']);
        $this->assertSame('red', $p['tone']);

        $early = S::project('active', Carbon::parse('2026-09-14'), Carbon::parse('2026-12-31'), 100, 48.0, $map, $today);
        $this->assertFalse($early['late']);
        $this->assertSame('green', $early['tone']);
        $this->assertStringContainsString('before the end date', $early['note']);
    }

    public function test_projection_edge_cases(): void
    {
        $today = Carbon::parse('2026-10-07');
        $start = Carbon::parse('2026-09-14');
        $end = Carbon::parse('2026-12-31');

        $this->assertSame('no_data', S::project('active', $start, $end, 100, 4.0, ['2026-10-06' => 4.0], $today)['state']);
        $this->assertSame('Not enough attendance yet', S::project('active', $start, $end, 100, 0.0, [], $today)['label']);
        $this->assertSame('met', S::project('active', $start, $end, 100, 120.0, $this->hoursMap(), $today)['state']);
        $this->assertSame('completed', S::project('completed', $start, $end, 100, 10.0, [], $today)['state']);
        $this->assertSame('not_started', S::project('active', Carbon::parse('2026-11-01'), $end, 100, 0.0, [], $today)['state']);
        // No hours in the last 3 weeks: falls back to the whole deployment.
        $old = ['2026-09-14' => 8.0, '2026-09-15' => 8.0];
        $this->assertSame('projected', S::project('active', Carbon::parse('2026-08-24'), $end, 100, 16.0, $old, $today)['state']);
    }

    // ------------------------------------------------------------ calendar

    public function test_calendar_day_states(): void
    {
        $today = Carbon::parse('2026-10-07');
        $by = [
            '2026-09-22' => ['state' => 'approved', 'hours' => 8.0],
            '2026-09-23' => ['state' => 'pending', 'hours' => null],
            '2026-09-24' => ['state' => 'rejected', 'hours' => null],
        ];
        $days = S::calendar('active', Carbon::parse('2026-09-16'), Carbon::parse('2026-12-31'), $by, $today);

        $this->assertCount(28, $days);
        $this->assertSame('2026-09-14', $days[0]['date']);
        $this->assertSame('O', $days[0]['code']);   // before the start date
        $this->assertSame('A', $days[2]['code']);   // Wed Sep 16, weekday, no attendance
        $this->assertSame('O', $days[5]['code']);   // Saturday
        $this->assertSame(['P', 8.0], [$days[8]['code'], $days[8]['hours']]);
        $this->assertSame('M', $days[9]['code']);
        $this->assertSame('X', $days[10]['code']);
        $this->assertSame('A', $days[22]['code']);  // Tue Oct 6
        $this->assertSame('F', $days[23]['code']);  // today, no clock-in yet
        $this->assertSame('F', $days[27]['code']);  // future

        $ended = S::calendar('active', Carbon::parse('2026-09-01'), Carbon::parse('2026-09-18'), [], $today);
        $this->assertSame('O', $ended[6]['code']);  // after the end date (Mon Sep 21)

        $expanded = S::expandCalendar(['start' => '2026-09-14', 'codes' => 'PO', 'hours' => [7.5, null]]);
        $this->assertSame('Mon, Sep 14: Present, 7.5 h', $expanded[0]['label']);
    }

    public function test_calendar_and_projection_are_in_the_api_rows_and_detail(): void
    {
        $d = $this->deployment();
        $d->update(['start_date' => '2026-09-14', 'end_date' => '2026-12-31', 'required_hours' => 100]);
        foreach (['2026-09-22', '2026-09-23'] as $date) {
            Attendance::create(['deployment_id' => $d->id, 'attendance_date' => $date, 'clock_in' => "{$date} 08:00:00", 'clock_out' => "{$date} 16:00:00", 'status' => 'approved']);
        }
        Sanctum::actingAs($this->dean());

        $row = $this->getJson('/api/dean/interns')->json('interns.0');
        $this->assertSame(28, strlen($row['calendar']['codes']));
        $this->assertSame('P', $row['calendar']['codes'][8]);
        $this->assertSame('projected', $row['projection']['state']);

        $detail = $this->getJson("/api/dean/interns/{$d->id}")->assertOk();
        $this->assertCount(28, $detail->json('calendar_days'));
        $this->assertStringContainsString('Present, 8 h', $detail->json('calendar_days.8.label'));
    }

    public function test_intern_list_query_count_does_not_grow_with_interns(): void
    {
        $base = $this->deployment();
        $make = function (int $from, int $to) use ($base) {
            for ($i = $from; $i < $to; $i++) {
                $u = User::create(['name' => "Intern {$i}", 'email' => "q{$i}@internova.test", 'password' => bcrypt('x'), 'role_id' => $base->intern->role_id, 'school_id' => $base->school_id, 'first_name' => 'In', 'last_name' => "Q{$i}", 'status' => 'active']);
                $d = InternshipDeployment::create(['school_id' => $base->school_id, 'intern_id' => $u->id, 'company_id' => $base->company_id, 'supervisor_id' => $base->supervisor_id, 'start_date' => '2026-09-14', 'end_date' => '2026-12-01', 'required_hours' => 480, 'status' => 'active']);
                Attendance::create(['deployment_id' => $d->id, 'attendance_date' => '2026-09-22', 'clock_in' => '2026-09-22 08:00:00', 'clock_out' => '2026-09-22 16:00:00', 'status' => 'approved']);
            }
        };
        Sanctum::actingAs($this->dean());
        $count = function () {
            \DB::flushQueryLog();
            \DB::enableQueryLog();
            $this->getJson('/api/dean/interns')->assertOk();

            return count(\DB::getQueryLog());
        };
        $make(0, 3);
        $this->getJson('/api/dean/interns')->assertOk(); // warm up
        $few = $count();
        $make(3, 15);
        $many = $count();
        $this->assertSame($few, $many);
        $this->assertLessThan(30, $many);
    }

    // ------------------------------------------------------------ scorecard + checklist + chart

    public function test_scorecard_numbers_and_reviewed_at(): void
    {
        $d = $this->deployment();
        $mk = fn (string $type, string $status) => Document::create(['deployment_id' => $d->id, 'uploaded_by' => $d->intern_id, 'document_type' => $type, 'file_name' => 'x.pdf', 'file_path' => 'documents/1/x.pdf', 'status' => $status]);

        $pending = $mk('Resume', 'pending');
        $this->log($pending, ['created_at' => now()->subDays(5)]);
        $approved = $mk('Waiver', 'approved');
        $this->log($approved, ['created_at' => now()->subDays(6), 'reviewed_at' => now()->subDays(4), 'updated_at' => now()->subDays(4)]);
        $rejected = $mk('MOA', 'rejected'); // old row: no reviewed_at, estimated from updated_at
        $this->log($rejected, ['created_at' => now()->subDays(10), 'reviewed_at' => null, 'updated_at' => now()->subDays(6)]);

        Sanctum::actingAs($this->dean());
        $res = $this->getJson('/api/dean/coordinator/insights')->assertOk();
        $m = collect($res->json('scorecard.metrics'))->keyBy('key');

        $this->assertEquals(3.0, $m['review_time']['value']); // (2 + 4) / 2
        $this->assertSame('watch', $m['review_time']['verdict']['key']);
        $this->assertStringContainsString('1 estimated', $m['review_time']['detail']);
        $this->assertSame(1, $m['backlog']['value']);
        $this->assertSame(0, $m['backlog']['previous']);
        $this->assertSame(1, $m['backlog']['stale']);
        $this->assertSame('watch', $m['backlog']['verdict']['key']);
        $this->assertSame(100, $m['supervisor']['value']);
        $this->assertSame('good', $m['supervisor']['verdict']['key']);
        $this->assertSame(100, $m['invitations']['value']);
        $this->assertNotEmpty($res->json('scorecard.help.thresholds'));

        // Backlog "4 weeks ago" counts a document that was waiting then.
        $old = $mk('Photo', 'approved');
        $this->log($old, ['created_at' => now()->subDays(40), 'reviewed_at' => now()->subDays(10), 'updated_at' => now()->subDays(10)]);
        $m = collect($this->getJson('/api/dean/coordinator/insights')->json('scorecard.metrics'))->keyBy('key');
        $this->assertSame(1, $m['backlog']['previous']);
    }

    public function test_reviewing_a_document_stamps_reviewed_at(): void
    {
        $d = $this->deployment();
        $doc = Document::create(['deployment_id' => $d->id, 'uploaded_by' => $d->intern_id, 'document_type' => 'Resume', 'file_name' => 'x.pdf', 'file_path' => 'documents/1/x.pdf', 'status' => 'pending']);
        Sanctum::actingAs($this->user('coordinator@internova.test'));

        $this->patchJson("/api/coordinator/documents/{$doc->id}", ['status' => 'approved'])->assertOk();
        $this->assertNotNull($doc->fresh()->reviewed_at);
    }

    public function test_setup_checklist(): void
    {
        Sanctum::actingAs($this->dean());
        $first = $this->getJson('/api/dean/coordinator/insights')->assertOk()->json('checklist');
        $items = collect($first['items'])->keyBy('key');

        $this->assertSame(6, $first['total']);
        $this->assertTrue($items['companies']['ok']);
        $this->assertTrue($items['interns']['ok']);
        $this->assertTrue($items['intern_supervisors']['ok']);
        $this->assertFalse($items['narrative']['ok']);
        $this->assertNotSame('', $items['narrative']['hint']);

        NarrativeTemplate::create(['school_id' => $this->dean()->school_id, 'letterhead' => ['school_name' => 'ABC'], 'cover' => ['department' => 'CCS']]);
        $second = $this->getJson('/api/dean/coordinator/insights')->json('checklist');
        $this->assertSame($first['done'] + 1, $second['done']);

        User::whereIn('id', \App\Models\SupervisorProfile::where('company_id', $this->deployment()->company_id)->pluck('user_id'))->update(['status' => 'inactive']);
        $items = collect($this->getJson('/api/dean/coordinator/insights')->json('checklist.items'))->keyBy('key');
        $this->assertFalse($items['intern_supervisors']['ok']);
        $this->getJson('/api/dean/overview')->assertJsonPath('setup.total', 6);
    }

    public function test_activity_chart_buckets(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $school = $coordinator->school_id;
        $mk = function (string $date, int $n, ?int $uid = null, ?int $sid = null) use ($coordinator, $school) {
            for ($i = 0; $i < $n; $i++) {
                $this->log(ActivityLogService::record('Documents', 'Approved document', 'x', $sid ?? $school, $uid ?? $coordinator->id), ['created_at' => "{$date} 09:00:00"]);
            }
        };
        $mk('2026-10-05', 2);
        $mk('2026-10-06', 1);
        $mk('2026-09-30', 3);
        $mk('2026-10-01', 4, $this->user('supervisor@internova.test')->id); // not the coordinator
        $mk('2026-10-05', 5, null, $this->otherSchool()[0]->id);            // other school
        $mk('2026-08-01', 9);                                               // older than 4 weeks

        Sanctum::actingAs($this->dean());
        $chart = $this->getJson('/api/dean/coordinator/insights')->json('activity_chart');

        $this->assertCount(28, $chart['days']);
        $this->assertSame('2026-09-14', $chart['days'][0]['date']);
        $this->assertSame(2, $chart['days'][21]['count']);
        $this->assertTrue($chart['days'][5]['weekend']);
        $this->assertFalse($chart['days'][21]['weekend']);
        $this->assertTrue($chart['days'][24]['future']);
        $this->assertSame(3, $chart['this_week']);
        $this->assertSame(3, $chart['last_week']);
        $this->assertCount(4, $chart['weeks']);
        $this->assertStringContainsString('This week 3, last week 3', $chart['summary']);
    }

    // ------------------------------------------------------------ feedback threads

    public function test_two_way_feedback_flow_with_notifications(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $dean = $this->dean();

        Sanctum::actingAs($dean);
        $id = $this->postJson('/api/dean/coordinator/feedback', ['message' => 'Please review the pile.'])->assertCreated()->json('feedback.id');
        $this->assertSame('open', DeanFeedback::find($id)->status);

        Sanctum::actingAs($coordinator);
        $this->getJson('/api/coordinator/feedback')->assertJsonPath('unread_count', 1)->assertJsonPath('items.0.status', 'open');
        $this->postJson("/api/coordinator/feedback/{$id}/acknowledge")->assertOk()->assertJsonPath('feedback.status', 'acknowledged');
        $this->assertSame(1, Notification::where('type', 'dean_feedback_ack')->where('user_id', $dean->id)->count());
        $this->postJson("/api/coordinator/feedback/{$id}/reply", ['message' => 'On it, done by Friday.'])->assertCreated();
        $this->assertSame(1, Notification::where('type', 'dean_feedback_reply')->where('user_id', $dean->id)->count());
        $this->getJson('/api/coordinator/feedback/unread-count')->assertJsonPath('unread_count', 0);

        Sanctum::actingAs($dean);
        $res = $this->getJson('/api/dean/coordinator/feedback')->assertOk();
        $res->assertJsonPath('unread_count', 1)->assertJsonPath('items.0.unread', 1)->assertJsonPath('items.0.replies.0.sender_role', 'coordinator');
        $this->getJson('/api/dean/coordinator/profile')->assertJsonPath('unread_replies', 1);
        $this->postJson('/api/dean/coordinator/feedback/read-all')->assertOk();
        $this->getJson('/api/dean/coordinator/feedback/unread-count')->assertJsonPath('unread_count', 0);

        $this->postJson("/api/dean/coordinator/feedback/{$id}/reply", ['message' => 'Thanks!'])->assertCreated();
        Sanctum::actingAs($coordinator);
        $this->getJson('/api/coordinator/feedback/unread-count')->assertJsonPath('unread_count', 1);
        $this->postJson("/api/coordinator/feedback/{$id}/read")->assertOk();
        $this->getJson('/api/coordinator/feedback/unread-count')->assertJsonPath('unread_count', 0);

        Sanctum::actingAs($dean);
        $this->postJson("/api/dean/coordinator/feedback/{$id}/resolve")->assertOk()->assertJsonPath('feedback.status', 'resolved');
        $this->assertNotNull(DeanFeedback::find($id)->resolved_at);
        Sanctum::actingAs($coordinator);
        $this->postJson("/api/coordinator/feedback/{$id}/reply", ['message' => 'one more'])->assertStatus(422);
        Sanctum::actingAs($dean);
        $this->postJson("/api/dean/coordinator/feedback/{$id}/reopen")->assertOk()->assertJsonPath('feedback.status', 'acknowledged');
        Sanctum::actingAs($coordinator);
        $this->postJson("/api/coordinator/feedback/{$id}/reply", ['message' => 'one more'])->assertCreated();
        $this->assertSame(3, DeanFeedback::find($id)->replies()->count());
    }

    public function test_replying_marks_an_open_thread_acknowledged_and_old_rows_default_to_open(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $f = DeanFeedback::create(['school_id' => $coordinator->school_id, 'dean_id' => $this->dean()->id, 'coordinator_id' => $coordinator->id, 'message' => 'Old row']);
        $this->assertSame('open', $f->fresh()->status);

        Sanctum::actingAs($coordinator);
        $this->postJson("/api/coordinator/feedback/{$f->id}/reply", ['message' => 'Noted'])->assertCreated()->assertJsonPath('feedback.status', 'acknowledged');
        $this->postJson("/api/coordinator/feedback/{$f->id}/reply", ['message' => ''])->assertStatus(422);
    }

    public function test_feedback_threads_are_school_scoped(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $f = DeanFeedback::create(['school_id' => $coordinator->school_id, 'dean_id' => $this->dean()->id, 'coordinator_id' => $coordinator->id, 'message' => 'Hi']);
        [, $otherDean, $otherCoordinator] = $this->otherSchool();

        Sanctum::actingAs($otherDean);
        $this->getJson('/api/dean/coordinator/feedback')->assertJsonCount(0, 'items');
        foreach (['reply', 'resolve', 'reopen'] as $action) {
            $this->postJson("/api/dean/coordinator/feedback/{$f->id}/{$action}", ['message' => 'x'])->assertNotFound();
        }

        Sanctum::actingAs($otherCoordinator);
        $this->getJson('/api/coordinator/feedback')->assertJsonCount(0, 'items');
        $this->postJson("/api/coordinator/feedback/{$f->id}/acknowledge")->assertNotFound();
        $this->postJson("/api/coordinator/feedback/{$f->id}/reply", ['message' => 'x'])->assertNotFound();
        $this->postJson("/api/coordinator/feedback/{$f->id}/read")->assertNotFound();
        $this->assertSame('open', $f->fresh()->status);

        Sanctum::actingAs($this->user('supervisor@internova.test'));
        $this->postJson("/api/dean/coordinator/feedback/{$f->id}/resolve")->assertForbidden();
    }

    // ------------------------------------------------------------ weekly summary email

    public function test_weekly_summary_command_queues_for_active_deans_who_opted_in(): void
    {
        $this->artisan('dean:weekly-summary')->assertSuccessful();
        Mail::assertQueued(DeanWeeklySummary::class, 1);
        Mail::assertQueued(DeanWeeklySummary::class, fn ($m) => $m->hasTo('dean@internova.test') && $m->summary['groups']['total'] === 1);
    }

    public function test_weekly_summary_respects_the_preference_and_dry_run(): void
    {
        $this->artisan('dean:weekly-summary --dry-run')->assertSuccessful();
        Mail::assertNothingQueued();

        Sanctum::actingAs($this->dean());
        $this->getJson('/api/dean/preferences')->assertJsonPath('weekly_summary_email', true);
        $this->patchJson('/api/dean/preferences', ['weekly_summary_email' => false])->assertOk()->assertJsonPath('weekly_summary_email', false);

        $this->artisan('dean:weekly-summary')->assertSuccessful();
        Mail::assertNothingQueued();
    }

    public function test_weekly_summary_skips_schools_without_an_active_subscription_and_other_roles(): void
    {
        $school = $this->dean()->school;
        $school->subscriptions()->update(['status' => 'cancelled']);
        $this->assertCount(0, DeanWeeklySummaryService::recipients());

        $school->subscriptions()->update(['status' => 'active']);
        $this->assertCount(1, DeanWeeklySummaryService::recipients());
        $school->update(['is_suspended' => true]);
        $this->assertCount(0, DeanWeeklySummaryService::recipients());
        $school->update(['is_suspended' => false]);
        $this->dean()->update(['status' => 'inactive']);
        $this->assertCount(0, DeanWeeklySummaryService::recipients());
        $this->artisan('dean:weekly-summary')->assertSuccessful();
        Mail::assertNothingQueued();
    }

    public function test_weekly_summary_email_content_renders(): void
    {
        $data = DeanWeeklySummaryService::build($this->dean());
        $this->assertSame('Sep 28 to Oct 4, 2026', $data['week_label']);
        $html = (new DeanWeeklySummary($data))->render();
        $this->assertStringContainsString($this->dean()->school->school_name, $html);
        $this->assertStringContainsString('At risk', $html);
        $this->assertStringContainsString('/dean/interns', $html);
        $this->assertStringContainsString('/dean/account', $html);
    }

    public function test_schedule_is_registered_for_monday_7am_manila(): void
    {
        $event = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())->first(fn ($e) => str_contains($e->command, 'dean:weekly-summary'));
        $this->assertNotNull($event);
        $this->assertSame('Asia/Manila', (string) $event->timezone);
        $this->assertSame('0 7 * * 1', $event->expression);
    }

    // ------------------------------------------------------------ Word report

    private function docxText($res): string
    {
        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($res->baseResponse->getFile()->getPathname()) === true);
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();

        return strip_tags(str_replace('</w:p>', "\n", $xml));
    }

    public function test_school_report_docx_downloads_and_is_scoped(): void
    {
        $dean = $this->dean();
        Sanctum::actingAs($dean);
        $res = $this->get('/api/dean/report/docx')->assertOk();
        $this->assertStringContainsString('wordprocessingml', $res->headers->get('content-type'));
        $text = $this->docxText($res);
        $this->assertStringContainsString($dean->school->school_name, $text);
        $this->assertStringContainsString('Coordinator scorecard', $text);
        $this->assertStringContainsString('Setup checklist', $text);
        $this->assertStringContainsString($this->deployment()->intern->first_name, $text);

        [$school, $otherDean] = $this->otherSchool();
        Sanctum::actingAs($otherDean);
        $other = $this->docxText($this->get('/api/dean/report/docx')->assertOk());
        $this->assertStringContainsString('Other College', $other);
        $this->assertStringNotContainsString($dean->school->school_name, $other);
        $this->assertStringNotContainsString($this->deployment()->intern->first_name, $other);

        // Other schools' interns are 404, and non-deans cannot download.
        $this->getJson("/api/dean/interns/{$this->deployment()->id}")->assertNotFound();
        Sanctum::actingAs($this->user('coordinator@internova.test'));
        $this->getJson('/api/dean/report/docx')->assertForbidden();
    }
}
