<?php

namespace Tests\Feature;

use App\Jobs\GenerateNarrativeForAttendance;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
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
 * A company chooses how its interns record attendance: one time in and out a
 * day, or morning and afternoon separately (four a day). The setting belongs
 * to the company, so every supervisor of it shares it.
 */
class AttendanceModeTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;
    private User $sup;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        Queue::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::where('intern_id', User::where('email', 'intern@internova.test')->value('id'))->firstOrFail();
        Attendance::where('deployment_id', $this->dep->id)->delete();
        $this->intern = User::findOrFail($this->dep->intern_id);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC')); // 9:00 AM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function mode(string $mode): void
    {
        Company::whereKey($this->dep->company_id)->update(['attendance_mode' => $mode]);
    }

    private function punch(string $action, array $extra = []): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($this->intern);

        return $this->post("/api/intern/attendance/{$action}", array_merge([
            'selfie' => UploadedFile::fake()->image('selfie.png'),
            'latitude' => 14.5547, 'longitude' => 121.0244,
        ], $extra), ['Accept' => 'application/json']);
    }

    private function today(): array
    {
        Sanctum::actingAs($this->intern);

        return $this->getJson('/api/intern/attendance/today')->assertOk()->json();
    }

    public function test_default_company_still_has_one_time_in_and_out(): void
    {
        $this->assertSame('single', Company::find($this->dep->company_id)->attendance_mode);

        $t = $this->today();
        $this->assertSame(['clock_in', 'full', 'Time in'], [$t['next_action'], $t['session'], $t['label']]);
        $this->assertCount(2, $t['steps']);

        $this->punch('clock-in')->assertOk();
        $this->assertSame(['clock_out', 'full'], [$this->today()['next_action'], $this->today()['session']]);
        $this->punch('clock-in')->assertStatus(422);
        $this->punch('clock-out')->assertOk();
        $this->assertNull($this->today()['next_action']);
        $this->assertSame(1, Attendance::where('deployment_id', $this->dep->id)->count());
        Queue::assertPushed(GenerateNarrativeForAttendance::class, 1);
    }

    public function test_split_company_walks_through_four_punches_in_order(): void
    {
        $this->mode('split');

        $labels = [];
        foreach ([['clock-in', 'am'], ['clock-out', 'am'], ['clock-in', 'pm'], ['clock-out', 'pm']] as $i => [$action, $session]) {
            $t = $this->today();
            $labels[] = $t['label'];
            $this->assertSame([str_replace('-', '_', $action), $session], [$t['next_action'], $t['session']], "step $i");
            Carbon::setTestNow(Carbon::now()->addHours(3));
            $this->punch($action)->assertOk();
        }
        $this->assertSame(['Morning time in', 'Morning time out', 'Afternoon time in', 'Afternoon time out'], $labels);
        $this->assertNull($this->today()['next_action']);

        $rows = Attendance::where('deployment_id', $this->dep->id)->orderBy('id')->get();
        $this->assertSame(['am', 'pm'], $rows->pluck('session')->all());
        $this->assertSame(360, $rows->sum(fn ($r) => $r->workedMinutes())); // two 3-hour halves
        // The daily summary is only written once the day is closed, not after the morning.
        Queue::assertPushed(GenerateNarrativeForAttendance::class, 1);
    }

    public function test_afternoon_cannot_start_before_the_morning_is_closed(): void
    {
        $this->mode('split');
        $this->punch('clock-in')->assertOk();
        $this->punch('clock-in', ['session' => 'pm'])->assertStatus(422);
        $this->punch('clock-in', ['session' => 'am'])->assertStatus(422);
    }

    public function test_a_day_keeps_its_format_if_the_setting_changes_midway(): void
    {
        $this->punch('clock-in')->assertOk(); // started as a single full day
        $this->mode('split');

        $t = $this->today();
        $this->assertSame(['clock_out', 'full', 'single'], [$t['next_action'], $t['session'], $t['mode']]);
        $this->punch('clock-out')->assertOk();
        $this->assertNull($this->today()['next_action']);
    }

    public function test_an_offline_entry_can_name_its_session(): void
    {
        $this->mode('split');
        $this->punch('clock-in', ['session' => 'am', 'is_offline' => 1, 'device_time' => now()->subMinutes(30)->toIso8601String(), 'device_now' => now()->toIso8601String()])
            ->assertOk()->assertJsonPath('record.session', 'am');
        $this->punch('clock-out', ['session' => 'am'])->assertOk();
        $this->assertSame(['am'], Attendance::where('deployment_id', $this->dep->id)->pluck('session')->all());
    }

    public function test_every_supervisor_of_the_company_shares_the_setting(): void
    {
        $second = User::create([
            'name' => 'Onyok Padilla', 'email' => 'second@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Onyok', 'last_name' => 'Padilla', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $second->id, 'school_id' => $this->dep->school_id, 'company_id' => $this->dep->company_id]);

        Sanctum::actingAs($this->sup);
        $this->getJson('/api/supervisor/attendance-settings')->assertOk()->assertJsonPath('attendance_mode', 'single')->assertJsonPath('company.id', $this->dep->company_id);
        $this->putJson('/api/supervisor/attendance-settings', ['attendance_mode' => 'weekly'])->assertStatus(422);
        $this->putJson('/api/supervisor/attendance-settings', ['attendance_mode' => 'split'])->assertOk()->assertJsonPath('attendance_mode', 'split');

        Sanctum::actingAs($second);
        $this->getJson('/api/supervisor/attendance-settings')->assertOk()->assertJsonPath('attendance_mode', 'split');
        $this->getJson('/api/supervisor/attendance')->assertOk()->assertJsonPath('attendance_mode', 'split');

        // The interns of that company are told (queued, so the supervisor does not wait for every live broadcast).
        Queue::assertPushed(\App\Jobs\NotifyInternsAttendanceFormatChanged::class);
        (new \App\Jobs\NotifyInternsAttendanceFormatChanged($this->dep->company_id, 'Attendance now has four entries a day.'))->handle();
        $this->assertTrue(Notification::where('user_id', $this->intern->id)->where('type', 'attendance_settings')->exists());
        $this->assertSame('Morning time in', $this->today()['label']);
    }

    public function test_only_a_supervisor_can_change_the_setting(): void
    {
        Sanctum::actingAs($this->intern);
        $this->putJson('/api/supervisor/attendance-settings', ['attendance_mode' => 'split'])->assertForbidden();
        $this->assertSame('single', Company::find($this->dep->company_id)->attendance_mode);
    }

    public function test_supervisor_can_log_a_morning_and_afternoon_day(): void
    {
        $this->mode('split');
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/supervisor/attendance', [
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-12',
            'clock_in' => '08:00', 'clock_out' => '12:00', 'pm_in' => '13:00', 'pm_out' => '17:00',
        ])->assertOk();

        $rows = Attendance::where('deployment_id', $this->dep->id)->orderBy('id')->get();
        $this->assertSame(['am', 'pm'], $rows->pluck('session')->all());
        $this->assertSame(480, $rows->sum(fn ($r) => $r->workedMinutes()));
        // Typed as Manila wall-clock time, stored as UTC.
        $this->assertSame('08:00 AM', $rows[0]->clock_in->local()->format('h:i A'));
    }

    public function test_report_has_a_dtr_table_and_no_attendance_photos(): void
    {
        $this->mode('split');
        foreach ([['am', '2026-10-12 00:00:00', '2026-10-12 04:00:00'], ['pm', '2026-10-12 05:00:00', '2026-10-12 09:00:00']] as [$s, $in, $out]) {
            Attendance::create([
                'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-12', 'session' => $s, 'clock_in' => $in, 'clock_out' => $out,
                'status' => 'approved', 'clock_in_selfie_path' => 'attendance/in.png', 'clock_out_selfie_path' => 'attendance/out.png',
            ]);
        }

        Sanctum::actingAs($this->intern);
        $res = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk();
        $this->assertArrayNotHasKey('attendance_photos', $res->json());
        $this->assertTrue($res->json('ledger.split'));
        $this->assertCount(1, $res->json('ledger.rows'));
        $this->assertSame(
            ['08:00 AM', '12:00 PM', '01:00 PM', '05:00 PM', 8],
            [$res->json('ledger.rows.0.am_in'), $res->json('ledger.rows.0.am_out'), $res->json('ledger.rows.0.pm_in'), $res->json('ledger.rows.0.pm_out'), $res->json('ledger.rows.0.hours')]
        );
        $this->assertNotContains('auto_attendance', collect($res->json('template.sections'))->pluck('source')->all());
    }
}
