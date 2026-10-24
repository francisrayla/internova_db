<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The internship has a first day and a last one: a start date can only be a few months from today,
 * and an intern who has not started cannot clock in or be given tasks; once the required hours are
 * rendered, clocking in closes.
 */
class DeploymentWindowTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Queue::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        Attendance::where('deployment_id', $this->dep->id)->delete();
        // The location rules have their own tests (AttendanceLocationTest); here the company has no map location.
        Company::whereKey($this->dep->company_id)->update(['latitude' => null, 'longitude' => null]);
        $this->intern = User::findOrFail($this->dep->intern_id);
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC')); // 9:00 AM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function clockIn()
    {
        return $this->post('/api/intern/attendance/clock-in', [
            'selfie' => UploadedFile::fake()->image('s.png'), 'latitude' => 14.5, 'longitude' => 121.0,
        ], ['Accept' => 'application/json']);
    }

    private function startOn(string $date, array $extra = []): void
    {
        $this->dep->update(array_merge(['start_date' => $date, 'status' => 'active'], $extra));
    }

    // ---- start date window -------------------------------------------------------------------

    public function test_a_start_date_far_away_is_refused_when_adding_an_intern(): void
    {
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $base = [
            'first_name' => 'Far', 'last_name' => 'Away', 'email' => 'far.away@gmail.com',
            'course' => 'BSIT', 'year_level' => '4th Year', 'company_id' => $this->dep->company_id,
        ];

        $this->postJson('/api/coordinator/interns', $base + ['start_date' => '2111-10-23'])
            ->assertStatus(422)->assertJsonValidationErrors('start_date');
        $this->postJson('/api/coordinator/interns', $base + ['start_date' => '2020-01-01'])
            ->assertStatus(422)->assertJsonValidationErrors('start_date');
        $this->assertDatabaseMissing('users', ['email' => 'far.away@gmail.com']);
    }

    public function test_the_window_edges_are_allowed(): void
    {
        [$min, $max] = InternshipDeployment::startDateBounds();
        $this->assertSame('2026-08-15', $min); // 60 days before 2026-10-14
        $this->assertSame('2027-01-12', $max); // 90 days after

        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $this->postJson('/api/coordinator/interns', [
            'first_name' => 'Soon', 'last_name' => 'Starter', 'email' => 'soon.starter@gmail.com',
            'course' => 'BSIT', 'year_level' => '4th Year', 'company_id' => $this->dep->company_id, 'start_date' => $max,
        ])->assertSuccessful();
    }

    public function test_editing_an_old_deployment_does_not_trip_over_its_original_start_date(): void
    {
        $this->dep->update(['start_date' => '2025-06-02']);
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());

        $this->patchJson("/api/coordinator/interns/{$this->dep->id}", ['required_hours' => 486, 'start_date' => '2025-06-02'])
            ->assertOk();
        $this->assertSame(486, $this->dep->fresh()->required_hours);

        // Moving the date is held to the window.
        $this->patchJson("/api/coordinator/interns/{$this->dep->id}", ['required_hours' => 486, 'start_date' => '2111-10-23'])
            ->assertStatus(422)->assertJsonValidationErrors('start_date');
    }

    // ---- not started yet ---------------------------------------------------------------------

    public function test_an_intern_cannot_clock_in_before_the_start_date(): void
    {
        $this->startOn('2026-10-23');
        Sanctum::actingAs($this->intern);

        $this->clockIn()->assertStatus(422)->assertJson(['code' => 'not_started'])
            ->assertJsonPath('message', 'Your internship starts on October 23, 2026. You can clock in from that day.');
        $this->assertSame(0, Attendance::where('deployment_id', $this->dep->id)->count());

        $this->getJson('/api/intern/attendance/today')->assertOk()
            ->assertJsonPath('clock_block.code', 'not_started')->assertJsonPath('clock_block.starts_on', '2026-10-23');
    }

    public function test_clocking_in_opens_on_the_first_day(): void
    {
        $this->startOn('2026-10-14');
        Sanctum::actingAs($this->intern);

        $this->clockIn()->assertSuccessful();
        $this->getJson('/api/intern/attendance/today')->assertOk()->assertJsonPath('clock_block', null);
    }

    public function test_a_task_cannot_be_given_to_an_intern_who_has_not_started(): void
    {
        $this->startOn('2026-10-23');
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());

        $this->postJson('/api/supervisor/tasks', [
            'deployment_ids' => [$this->dep->id], 'title' => 'Too early', 'priority' => 'low',
        ])->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'not started'));
        $this->assertDatabaseMissing('tasks', ['title' => 'Too early']);

        $opt = collect($this->getJson('/api/supervisor/attendance')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertSame('2026-10-23', $opt['starts_on']);

        $this->startOn('2026-10-14');
        $this->postJson('/api/supervisor/tasks', [
            'deployment_ids' => [$this->dep->id], 'title' => 'On time', 'priority' => 'low',
        ])->assertSuccessful();
    }

    public function test_a_supervisor_cannot_log_attendance_before_the_start_date(): void
    {
        $this->startOn('2026-10-12');
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());

        $this->postJson('/api/supervisor/attendance', [
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-11', 'clock_in' => '08:00', 'clock_out' => '17:00',
        ])->assertStatus(422);
        $this->assertSame(0, Attendance::where('deployment_id', $this->dep->id)->count());

        $this->postJson('/api/supervisor/attendance', [
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-12', 'clock_in' => '08:00', 'clock_out' => '16:00',
        ])->assertSuccessful();
    }

    // ---- finished ----------------------------------------------------------------------------

    public function test_clocking_in_closes_once_the_required_hours_are_rendered(): void
    {
        $this->startOn('2026-09-01', ['required_hours' => 8]);
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:30:00', 'status' => 'approved',
        ]);
        Sanctum::actingAs($this->intern);

        $this->clockIn()->assertStatus(422)->assertJson(['code' => 'finished'])
            ->assertJsonPath('message', 'You have completed your 8 required hours, so attendance is now closed.');
        $this->getJson('/api/intern/attendance/today')->assertJsonPath('clock_block.code', 'finished');
    }

    public function test_hours_still_pending_do_not_close_attendance(): void
    {
        $this->startOn('2026-09-01', ['required_hours' => 8]);
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:30:00', 'status' => 'pending',
        ]);
        Sanctum::actingAs($this->intern);

        $this->clockIn()->assertSuccessful();
    }

    public function test_a_completed_or_inactive_deployment_cannot_clock_in(): void
    {
        Sanctum::actingAs($this->intern);

        $this->startOn('2026-09-01', ['status' => 'completed']);
        $this->clockIn()->assertStatus(422)->assertJson(['code' => 'finished']);

        $this->startOn('2026-09-01', ['status' => 'inactive']);
        $this->clockIn()->assertStatus(422)->assertJson(['code' => 'inactive']);
    }

    public function test_a_task_cannot_be_given_to_an_intern_who_finished_the_hours(): void
    {
        $this->startOn('2026-09-01', ['required_hours' => 8]);
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:30:00', 'status' => 'approved',
        ]);
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());

        // Still listed (the task filter keeps their History) but flagged, so the Assign picker leaves them out.
        $opt = collect($this->getJson('/api/supervisor/tasks?view=active')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertTrue($opt['finished']);

        $this->postJson('/api/supervisor/tasks', [
            'deployment_ids' => [$this->dep->id], 'title' => 'Too late', 'priority' => 'low',
        ])->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'already completed'));
        $this->assertDatabaseMissing('tasks', ['title' => 'Too late']);

        $this->startOn('2026-09-01', ['required_hours' => 500]);
        $opt = collect($this->getJson('/api/supervisor/tasks?view=active')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertFalse($opt['finished']);
    }

    public function test_a_supervisor_cannot_log_attendance_for_a_finished_intern(): void
    {
        $this->startOn('2026-09-01', ['required_hours' => 8]);
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:30:00', 'status' => 'approved',
        ]);
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());

        $this->postJson('/api/supervisor/attendance', [
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-14', 'clock_in' => '08:00', 'clock_out' => '08:30',
        ])->assertStatus(422);
    }
}
