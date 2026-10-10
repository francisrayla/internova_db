<?php

namespace Tests\Feature;

use App\Models\Attendance;
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
 * An intern who forgets to time out: the system closes the shift, tells the supervisors (the only
 * attendance news they get), and a supervisor can correct the time so the hours come down.
 */
class AutoClockOutTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;
    private User $supA;
    private User $supB;

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
        $this->supA = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->supB = User::create([
            'name' => 'Onyok Padilla', 'email' => 'second@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Onyok', 'last_name' => 'Padilla', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $this->supB->id, 'school_id' => $this->dep->school_id, 'company_id' => $this->dep->company_id]);
        Carbon::setTestNow(Carbon::parse('2026-10-14 12:00:00', 'UTC')); // 8:00 PM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function forgottenShift(): Attendance
    {
        // Timed in 8:00 AM Manila, never timed out; it is now evening, long past 8 hours.
        return Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-14', 'session' => 'full',
            'clock_in' => '2026-10-14 00:00:00', 'status' => 'approved',
        ]);
    }

    public function test_the_system_closes_a_forgotten_shift_and_only_that_notifies_the_supervisors(): void
    {
        $a = $this->forgottenShift();
        Attendance::autoCloseStale();

        $a->refresh();
        $this->assertTrue($a->auto_clocked_out);
        $this->assertSame('2026-10-14 08:00:00', $a->clock_out->toDateTimeString());

        foreach ([$this->supA, $this->supB] as $sup) {
            $n = Notification::where('user_id', $sup->id)->where('type', 'attendance_auto_closed')->get();
            $this->assertCount(1, $n);
            $this->assertStringContainsString('forgot to time out', strtolower($n[0]->title));
            $this->assertStringContainsString('04:00 PM', $n[0]->body);
        }

        // Running it again must not announce the same shift twice.
        Attendance::autoCloseStale();
        $this->assertSame(2, Notification::where('type', 'attendance_auto_closed')->count());
    }

    public function test_clocking_in_and_out_no_longer_pings_the_supervisors(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC'));
        Sanctum::actingAs($this->intern);
        $punch = fn (string $a) => $this->post("/api/intern/attendance/{$a}", ['selfie' => UploadedFile::fake()->image('s.png'), 'latitude' => 14.5547, 'longitude' => 121.0244], ['Accept' => 'application/json'])->assertOk();
        $punch('clock-in');
        Carbon::setTestNow(now()->addHours(7)); // before the 8-hour cut-off
        $punch('clock-out');

        $this->assertSame(0, Notification::whereIn('user_id', [$this->supA->id, $this->supB->id])->count());
    }

    public function test_the_supervisor_corrects_the_time_and_the_hours_come_down(): void
    {
        $a = $this->forgottenShift();
        Attendance::autoCloseStale();

        Sanctum::actingAs($this->supB); // any supervisor of the company
        $row = collect($this->getJson('/api/supervisor/attendance')->assertOk()->json('records'))->firstWhere('id', $a->id);
        $this->assertTrue($row['can_edit_times']);
        $this->assertEquals([8, '08:00', '16:00'], [$row['hours'], $row['clock_in_value'], $row['clock_out_value']]);

        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '08:00', 'clock_out' => '13:30'])
            ->assertOk()->assertJsonPath('hours', 5.5);

        $a->refresh();
        $this->assertFalse($a->auto_clocked_out);
        $this->assertSame($this->supB->id, $a->edited_by);
        $this->assertNotNull($a->edited_at);
        $this->assertSame(330, $a->workedMinutes());
        $this->assertTrue(Notification::where('user_id', $this->intern->id)->where('type', 'attendance_edited')->exists());

        // It stays correctable by a supervisor, and is marked as corrected for everyone who looks.
        $again = collect($this->getJson('/api/supervisor/attendance')->json('records'))->firstWhere('id', $a->id);
        $this->assertTrue($again['edited'] && $again['can_edit_times']);
        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '08:00', 'clock_out' => '12:00'])->assertOk();
    }

    public function test_a_correction_cannot_be_longer_or_backwards(): void
    {
        $a = $this->forgottenShift();
        Attendance::autoCloseStale();
        Sanctum::actingAs($this->supA);

        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '08:00', 'clock_out' => '18:00'])->assertStatus(422); // more than 8 h
        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '10:00', 'clock_out' => '09:00'])->assertStatus(422);
        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '8am', 'clock_out' => '1pm'])->assertStatus(422);
        $this->assertTrue($a->fresh()->auto_clocked_out); // untouched
    }

    public function test_any_record_can_be_corrected_not_only_an_automatically_closed_one(): void
    {
        // Used to be refused (422); now every record of the company's interns can be corrected (see AttendanceCorrectionTest).
        $normal = Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 08:00:00', 'status' => 'approved',
        ]);
        Sanctum::actingAs($this->supA);
        $this->patchJson("/api/supervisor/attendance/{$normal->id}/times", ['clock_in' => '08:00', 'clock_out' => '12:00'])->assertOk();
        $row = collect($this->getJson('/api/supervisor/attendance')->json('records'))->firstWhere('id', $normal->id);
        $this->assertTrue($row['can_edit_times']);
    }

    public function test_only_supervisors_of_that_company_can_correct(): void
    {
        $a = $this->forgottenShift();
        Attendance::autoCloseStale();

        Sanctum::actingAs($this->intern);
        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '08:00', 'clock_out' => '12:00'])->assertForbidden();

        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        Sanctum::actingAs($coordinator);
        $this->patchJson("/api/supervisor/attendance/{$a->id}/times", ['clock_in' => '08:00', 'clock_out' => '12:00'])->assertForbidden();
    }

    public function test_supervisor_coordinator_and_dean_all_get_the_photos(): void
    {
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 00:00:00', 'clock_out' => '2026-10-13 09:00:00', 'status' => 'approved',
            'clock_in_selfie_path' => 'attendance/in.png', 'clock_out_selfie_path' => 'attendance/out.png',
        ]);

        Sanctum::actingAs($this->supA);
        $s = $this->getJson('/api/supervisor/attendance')->json('records.0');
        $this->assertNotNull($s['clock_in_selfie_url']);
        $this->assertNotNull($s['clock_out_selfie_url']);

        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $c = $this->getJson('/api/coordinator/attendance')->json('records.0');
        $this->assertNotNull($c['clock_in_selfie_url']);
        $this->assertNotNull($c['clock_out_selfie_url']);

        Sanctum::actingAs(User::where('email', 'dean@internova.test')->firstOrFail());
        $d = $this->getJson("/api/dean/interns/{$this->dep->id}")->assertOk()->json('attendance.0');
        $this->assertNotNull($d['clock_in_selfie_url']);
        $this->assertNotNull($d['clock_out_selfie_url']);
    }
}
