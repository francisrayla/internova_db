<?php

namespace Tests\Feature;

use App\Jobs\GenerateNarrativeForAttendance;
use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A supervisor can correct or delete ANY attendance record of an intern at their company.
 * Hours, "finished", the clock-in rules and the drafted daily summary all follow.
 */
class AttendanceCorrectionTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;
    private User $sup;
    private User $stranger;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Queue::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        Attendance::where('deployment_id', $this->dep->id)->delete();
        Notification::query()->delete();
        $this->intern = User::findOrFail($this->dep->intern_id);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $this->stranger = User::create([
            'name' => 'Ana Reyes', 'email' => 'stranger@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $this->stranger->id, 'school_id' => $this->dep->school_id, 'company_id' => $other->id]);
        Carbon::setTestNow(Carbon::parse('2026-10-14 12:00:00', 'UTC')); // 8:00 PM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** 2026-10-13, 8:00 AM to 4:00 PM Manila (the seed's UTC 00:00 - 08:00). */
    private function shift(array $over = []): Attendance
    {
        return Attendance::create($over + [
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:00:00', 'status' => 'approved',
        ]);
    }

    private function correct(Attendance $a, string $in, ?string $out)
    {
        return $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => $in, 'clock_out' => $out]);
    }

    private function draft(string $date = '2026-10-13', array $over = []): DailyActivity
    {
        return DailyActivity::create($over + [
            'deployment_id' => $this->dep->id, 'activity_date' => $date, 'title' => 'Daily Activity Summary',
            'description' => 'Reported for on-the-job training from 08:00 AM to 04:00 PM.',
            'status' => DailyActivity::RECORDED, 'is_auto_generated' => true,
        ]);
    }

    // ---- correct ------------------------------------------------------------------------------

    public function test_a_normal_record_can_be_corrected_with_all_side_effects(): void
    {
        $a = $this->shift();
        Sanctum::actingAs($this->sup);

        $row = collect($this->getJson('/api/supervisor/attendance')->json('records'))->firstWhere('id', $a->id);
        $this->assertTrue($row['can_edit_times'] && $row['can_delete']);

        $this->correct($a, '09:00', '13:30')->assertOk()->assertJsonPath('hours', 4.5);

        $a->refresh();
        $this->assertSame('2026-10-13 01:00:00', $a->clock_in->toDateTimeString()); // Manila 9:00 AM = 01:00 UTC
        $this->assertSame('2026-10-13 05:30:00', $a->clock_out->toDateTimeString());
        $this->assertSame($this->sup->id, $a->edited_by);
        $this->assertNotNull($a->edited_at);
        $this->assertSame('approved', $a->status);
        $this->assertSame(270, $a->workedMinutes());
        $this->assertSame(1, Notification::where('user_id', $this->intern->id)->where('type', 'attendance_edited')->count());
        $this->assertTrue(ActivityLog::where('module', 'Attendance')->where('action', 'Corrected attendance time')->exists());
    }

    public function test_the_safety_rules_hold_and_nothing_changes_on_a_refusal(): void
    {
        $a = $this->shift();
        Sanctum::actingAs($this->sup);

        $this->correct($a, '10:00', '09:00')->assertStatus(422)->assertJsonValidationErrors('clock_out'); // backwards
        $this->correct($a, '10:00', '10:00')->assertStatus(422);                                          // zero length
        $this->correct($a, '08:00', '17:00')->assertStatus(422);                                          // 9 h > 8 h cap
        $this->correct($a, '8am', '1pm')->assertStatus(422);                                              // not HH:MM
        $this->correct($a, '08:00', null)->assertStatus(422);                                             // a finished shift keeps its time out
        $this->assertSame(480, $a->fresh()->workedMinutes());
        $this->assertNull($a->fresh()->edited_at);
        $this->assertSame(0, Notification::where('type', 'attendance_edited')->count());
    }

    public function test_nothing_can_be_set_in_the_future(): void
    {
        // Today is 2026-10-14 and it is 8:00 PM in Manila.
        $today = $this->shift([
            'attendance_date' => '2026-10-14', 'clock_in' => '2026-10-14 00:00:00', 'clock_out' => '2026-10-14 08:00:00',
        ]);
        Sanctum::actingAs($this->sup);

        $this->correct($today, '08:00', '21:00')->assertStatus(422)->assertJsonValidationErrors('clock_out');
        $this->correct($today, '21:00', '21:30')->assertStatus(422)->assertJsonValidationErrors('clock_in');
        $this->correct($today, '08:00', '16:00')->assertOk();
    }

    public function test_a_half_day_is_capped_at_four_hours_and_the_halves_cannot_overlap(): void
    {
        $am = $this->shift(['session' => 'am', 'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 04:00:00']);   // 8-12
        $pm = $this->shift(['session' => 'pm', 'clock_in' => '2026-10-13 05:00:00', 'clock_out' => '2026-10-13 09:00:00']);   // 13-17
        Sanctum::actingAs($this->sup);

        $this->correct($pm, '13:00', '17:30')->assertStatus(422);                                           // 4.5 h > 4 h
        $this->assertStringContainsString('afternoon', $this->correct($am, '10:00', '13:30')->assertStatus(422)->json('errors.clock_out.0'));
        $this->correct($pm, '11:30', '15:30')->assertStatus(422);                                           // starts before the morning ends
        $this->correct($am, '08:30', '13:00')->assertStatus(422);                                           // 4.5 h
        $this->correct($am, '08:30', '12:00')->assertOk();
        $this->correct($pm, '12:00', '16:00')->assertOk();                                                  // touching is fine
        $this->assertSame([210, 240], [$am->fresh()->workedMinutes(), $pm->fresh()->workedMinutes()]);
    }

    public function test_a_shift_still_open_keeps_its_time_in_corrected_and_can_be_closed(): void
    {
        $open = $this->shift(['attendance_date' => '2026-10-14', 'clock_in' => '2026-10-14 09:00:00', 'clock_out' => null]); // 5 PM Manila
        Sanctum::actingAs($this->sup);

        $this->assertTrue(collect($this->getJson('/api/supervisor/attendance')->json('records'))->firstWhere('id', $open->id)['is_open']);
        $this->correct($open, '16:30', null)->assertOk()->assertJsonPath('hours', null);
        $this->assertNull($open->fresh()->clock_out);
        $this->assertSame('2026-10-14 08:30:00', $open->fresh()->clock_in->toDateTimeString());

        $this->correct($open, '16:30', '19:30')->assertOk()->assertJsonPath('hours', 3);
        $this->assertNotNull($open->fresh()->clock_out);
    }

    public function test_the_odd_hours_flag_follows_the_corrected_time_in_and_a_checked_flag_stays_checked(): void
    {
        Sanctum::actingAs($this->sup);

        // 1) Normal -> odd (6:30 PM): becomes red, but the supervisor who typed it has looked at it, so nobody is pinged.
        $a = $this->shift();
        $this->correct($a, '18:30', '19:30')->assertOk();
        $a->refresh();
        $this->assertTrue($a->clock_in_odd_hours && $a->red_flag);
        $this->assertSame($this->sup->id, $a->red_flag_checked_by);
        $this->assertSame(0, Notification::where('type', 'attendance_red_flag')->count());

        // 2) Odd and unchecked -> normal: the flag goes away.
        $b = $this->shift(['attendance_date' => '2026-10-12', 'clock_in' => '2026-10-12 10:30:00', 'clock_out' => '2026-10-12 12:00:00', 'clock_in_odd_hours' => true]);
        $this->assertTrue($b->fresh()->red_flag);
        $this->assertNull($b->fresh()->red_flag_checked_at);
        $this->correct($b, '09:00', '12:00')->assertOk();
        $this->assertFalse($b->fresh()->red_flag);

        // 3) Odd and already checked -> still odd: stays checked by the same person, not pinned again.
        $c = $this->shift(['attendance_date' => '2026-10-11', 'clock_in' => '2026-10-11 10:30:00', 'clock_out' => '2026-10-11 12:00:00', 'clock_in_odd_hours' => true,
            'red_flag_checked_by' => $this->stranger->id, 'red_flag_checked_at' => '2026-10-11 13:00:00']);
        $this->correct($c, '19:00', '20:00')->assertOk();
        $c->refresh();
        $this->assertTrue($c->red_flag);
        $this->assertSame($this->stranger->id, $c->red_flag_checked_by);
        $this->assertSame('2026-10-11 13:00:00', $c->red_flag_checked_at->toDateTimeString());
        $unchecked = collect($this->getJson('/api/supervisor/attendance?flag=unchecked')->json('records'));
        $this->assertFalse($unchecked->contains('id', $c->id));
    }

    public function test_the_drafted_summary_is_written_again_but_the_interns_own_entry_is_kept(): void
    {
        $a = $this->shift();
        $draft = $this->draft();
        Sanctum::actingAs($this->sup);

        $this->correct($a, '09:00', '12:00')->assertOk();
        $this->assertNull(DailyActivity::find($draft->id));
        Queue::assertPushed(GenerateNarrativeForAttendance::class, fn ($j) => true);

        // An entry the intern wrote (or edited, which turns it into pending) is never removed.
        Queue::fake();
        $own = $this->draft('2026-10-13', ['title' => 'My day', 'status' => DailyActivity::PENDING, 'is_auto_generated' => false]);
        $this->correct($a, '09:00', '11:00')->assertOk();
        $this->assertNotNull(DailyActivity::find($own->id));
        Queue::assertNothingPushed();
    }

    // ---- permissions --------------------------------------------------------------------------

    public function test_only_supervisors_of_that_company_can_correct_or_delete(): void
    {
        $a = $this->shift();

        Sanctum::actingAs($this->stranger);
        $this->correct($a, '09:00', '12:00')->assertNotFound();
        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertNotFound();

        foreach (['intern@internova.test', 'coordinator@internova.test', 'dean@internova.test'] as $email) {
            Sanctum::actingAs(User::where('email', $email)->firstOrFail());
            $this->correct($a, '09:00', '12:00')->assertForbidden();
            $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertForbidden();
        }

        $this->assertNotNull(Attendance::find($a->id));
        $this->assertNull($a->fresh()->edited_at);

        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertOk();
    }

    // ---- delete -------------------------------------------------------------------------------

    public function test_deleting_removes_the_record_and_photos_tells_the_intern_and_is_logged(): void
    {
        Storage::disk('public')->put('attendance/in.png', 'x');
        Storage::disk('public')->put('attendance/out.png', 'x');
        $a = $this->shift(['clock_in_selfie_path' => 'attendance/in.png', 'clock_out_selfie_path' => 'attendance/out.png']);
        $keep = $this->shift(['attendance_date' => '2026-10-12', 'clock_in' => '2026-10-12 00:00:00', 'clock_out' => '2026-10-12 08:00:00']);
        Sanctum::actingAs($this->sup);

        $this->deleteJson("/api/supervisor/attendance/{$a->id}", ['reason' => 'Entered by mistake'])->assertOk();

        $this->assertNull(Attendance::find($a->id));
        $this->assertNotNull(Attendance::find($keep->id));
        Storage::disk('public')->assertMissing('attendance/in.png');
        Storage::disk('public')->assertMissing('attendance/out.png');
        $n = Notification::where('user_id', $this->intern->id)->where('type', 'attendance_deleted')->get();
        $this->assertCount(1, $n);
        $this->assertStringContainsString('Oct 13, 2026', $n[0]->body);
        $this->assertStringContainsString('Entered by mistake', $n[0]->body);
        $this->assertTrue(ActivityLog::where('module', 'Attendance')->where('action', 'Deleted attendance')->where('description', 'like', '%Entered by mistake%')->exists());
    }

    public function test_deleting_lowers_the_hours_and_reopens_an_intern_who_was_finished(): void
    {
        $this->dep->update(['required_hours' => 8]);
        $a = $this->shift(); // exactly 8 approved hours
        Sanctum::actingAs($this->intern);
        $this->assertSame('finished', $this->getJson('/api/intern/attendance/today')->json('clock_block.code'));

        Sanctum::actingAs($this->sup);
        $this->assertTrue(collect($this->getJson('/api/supervisor/interns')->json('interns'))->firstWhere('deployment_id', $this->dep->id)['is_finished']);
        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertOk();
        $row = collect($this->getJson('/api/supervisor/interns')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertFalse($row['is_finished']);
        $this->assertEquals(0, $row['hours_completed']);

        // The clock-in rule follows: the intern is no longer blocked.
        Sanctum::actingAs($this->intern);
        $this->assertNull($this->getJson('/api/intern/attendance/today')->json('clock_block'));
        $this->assertFalse($this->dep->fresh()->isFinished());
    }

    public function test_deleting_the_open_shift_of_today_lets_the_intern_clock_in_again(): void
    {
        $open = $this->shift(['attendance_date' => '2026-10-14', 'clock_in' => '2026-10-14 09:00:00', 'clock_out' => null]);
        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/supervisor/attendance/{$open->id}")->assertOk();
        $this->assertSame(0, Attendance::where('deployment_id', $this->dep->id)->count());
    }

    public function test_an_evaluation_already_given_is_left_alone(): void
    {
        $this->dep->update(['required_hours' => 8]);
        $a = $this->shift();
        $evaluation = \App\Models\Evaluation::create([
            'deployment_id' => $this->dep->id, 'evaluator_id' => $this->sup->id,
            'evaluation_date' => '2026-10-13', 'overall_score' => 90, 'status' => 'submitted',
        ]);
        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertOk();
        $this->assertNotNull(\App\Models\Evaluation::find($evaluation->id));
    }

    public function test_the_unedited_drafted_summary_of_an_empty_day_goes_but_the_interns_own_entries_stay(): void
    {
        $a = $this->shift();
        $draft = $this->draft();
        $own = $this->draft('2026-10-13', ['title' => 'Filing', 'description' => 'I filed.', 'status' => DailyActivity::PENDING, 'is_auto_generated' => false]);
        $approved = $this->draft('2026-10-13', ['title' => 'Reviewed', 'status' => DailyActivity::APPROVED, 'is_auto_generated' => false]);
        $otherDay = $this->draft('2026-10-12');
        Sanctum::actingAs($this->sup);

        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertOk();

        $this->assertNull(DailyActivity::find($draft->id));
        $this->assertNotNull(DailyActivity::find($own->id));
        $this->assertNotNull(DailyActivity::find($approved->id));
        $this->assertNotNull(DailyActivity::find($otherDay->id)); // a different day is untouched
        Queue::assertNothingPushed(); // no attendance left on that day: nothing to write again
    }

    public function test_deleting_one_half_of_a_split_day_rewrites_the_draft_from_what_is_left(): void
    {
        $am = $this->shift(['session' => 'am', 'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 04:00:00']);
        $pm = $this->shift(['session' => 'pm', 'clock_in' => '2026-10-13 05:00:00', 'clock_out' => '2026-10-13 09:00:00']);
        $draft = $this->draft();
        Sanctum::actingAs($this->sup);

        $this->deleteJson("/api/supervisor/attendance/{$am->id}")->assertOk();

        $this->assertNull(DailyActivity::find($draft->id));
        Queue::assertPushed(GenerateNarrativeForAttendance::class, 1);
        $this->assertNotNull(Attendance::find($pm->id));
    }

    public function test_the_job_does_not_bring_a_deleted_day_back(): void
    {
        $a = $this->shift();
        $this->draft();
        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/supervisor/attendance/{$a->id}")->assertOk();

        // The job for a record that no longer exists exits quietly.
        (new GenerateNarrativeForAttendance($a->id))->handle();
        $this->assertSame(0, DailyActivity::where('deployment_id', $this->dep->id)->count());
    }
}
