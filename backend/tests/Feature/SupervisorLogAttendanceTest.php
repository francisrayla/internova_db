<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * "Log attendance" by the supervisor must obey the same safety rules as "Correct attendance":
 * a time in is required, nothing in the future, no shift longer than a workday, no overlap with a record
 * the intern already has that day. An odd-hours time typed by the supervisor is red but already checked.
 */
class SupervisorLogAttendanceTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $sup;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        Attendance::where('deployment_id', $this->dep->id)->delete();
        $this->dep->update(['start_date' => '2026-09-01', 'status' => 'active', 'required_hours' => 500]);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        Carbon::setTestNow(Carbon::parse('2026-10-14 07:00:00', 'UTC')); // 3:00 PM Wednesday in Manila
        Sanctum::actingAs($this->sup);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function log(array $extra = [])
    {
        return $this->postJson('/api/supervisor/attendance', array_merge([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-12', 'clock_in' => '09:00', 'clock_out' => '17:00',
        ], $extra));
    }

    public function test_a_normal_day_is_logged_once_and_a_second_overlapping_log_is_refused(): void
    {
        $this->log()->assertOk();
        $this->log()->assertStatus(422)->assertJsonValidationErrors('clock_in');
        $this->log(['clock_in' => '16:00', 'clock_out' => '17:30'])->assertStatus(422);
        $this->assertSame(1, Attendance::where('deployment_id', $this->dep->id)->count());
        // A different day is fine, and so is a non-overlapping extra shift the same day.
        $this->log(['attendance_date' => '2026-10-13'])->assertOk();
        $this->log(['clock_in' => '05:30', 'clock_out' => '08:30'])->assertOk();
    }

    public function test_the_log_form_cannot_make_a_shift_longer_than_a_workday(): void
    {
        $this->log(['clock_in' => '00:00', 'clock_out' => '23:59'])->assertStatus(422)->assertJsonValidationErrors('clock_out');
        $this->log(['clock_in' => '08:00', 'clock_out' => '16:01'])->assertStatus(422);
        $this->log(['clock_in' => '08:00', 'clock_out' => '16:00'])->assertOk();
    }

    public function test_the_future_and_empty_rows_are_refused(): void
    {
        $this->log(['attendance_date' => '2026-10-15'])->assertStatus(422)->assertJsonValidationErrors('attendance_date');
        // Today, but later than it is now (3:00 PM in Manila).
        $this->log(['attendance_date' => '2026-10-14', 'clock_in' => '14:00', 'clock_out' => '16:00'])->assertStatus(422)->assertJsonValidationErrors('clock_out');
        $this->log(['attendance_date' => '2026-10-14', 'clock_in' => '09:00', 'clock_out' => '12:00'])->assertOk();
        $this->postJson('/api/supervisor/attendance', ['deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-11'])
            ->assertStatus(422)->assertJsonValidationErrors('clock_in');
        $this->postJson('/api/supervisor/attendance', ['deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-11', 'clock_out' => '10:00'])
            ->assertStatus(422);
        $this->assertSame(1, Attendance::where('deployment_id', $this->dep->id)->count());
    }

    public function test_an_odd_hours_time_typed_by_the_supervisor_is_red_but_already_checked(): void
    {
        $this->log(['clock_in' => '18:00', 'clock_out' => '22:00'])->assertOk();
        $row = Attendance::where('deployment_id', $this->dep->id)->firstOrFail();
        $this->assertTrue((bool) $row->clock_in_odd_hours);
        $this->assertTrue((bool) $row->red_flag);
        $this->assertSame($this->sup->id, (int) $row->red_flag_checked_by);
        $unchecked = collect($this->getJson('/api/supervisor/attendance?flag=unchecked')->assertOk()->json('records'));
        $this->assertCount(0, $unchecked);
        $this->assertCount(1, $this->getJson('/api/supervisor/attendance?flag=red')->json('records'));
        // Ordinary hours stay unflagged.
        $this->log(['attendance_date' => '2026-10-13'])->assertOk();
        $this->assertCount(1, $this->getJson('/api/supervisor/attendance?flag=red')->json('records'));
    }

    public function test_a_morning_and_afternoon_is_only_for_a_company_on_that_format(): void
    {
        $split = ['clock_in' => '08:00', 'clock_out' => '12:00', 'pm_in' => '13:00', 'pm_out' => '17:00'];
        $this->log($split)->assertStatus(422)->assertJsonValidationErrors('pm_in');
        $this->assertSame(0, Attendance::where('deployment_id', $this->dep->id)->count());

        Company::whereKey($this->dep->company_id)->update(['attendance_mode' => 'split']);
        $this->log($split)->assertOk();
        $this->assertSame(['am', 'pm'], Attendance::where('deployment_id', $this->dep->id)->orderBy('id')->pluck('session')->all());
        $this->log(['attendance_date' => '2026-10-13', 'clock_in' => '08:00', 'clock_out' => '12:00', 'pm_out' => '17:00'])->assertStatus(422);
        // Afternoon cannot reach into a record already there.
        $this->log(array_merge($split, ['clock_in' => '07:00', 'clock_out' => '11:00', 'pm_in' => '12:00', 'pm_out' => '16:00']))->assertStatus(422);
    }
}
