<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\User;
use App\Services\AttendanceLocationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An intern may clock in from anywhere: there is no distance limit. What is refused is a location that looks
 * forged (the browser's location functions replaced, a jump between punches nobody could travel, a stale or very
 * imprecise fix). The patterns a fake-GPS app leaves are flagged for the reviewer, and only an online clock-in
 * is ever refused.
 */
class AttendanceLocationTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private Company $company;
    private User $intern;

    // The company sits at this point; 0.001 degrees of latitude is about 111 m.
    private const LAT = 13.0000000;
    private const LNG = 121.0000000;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Queue::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['start_date' => '2026-09-01', 'required_hours' => 5000, 'status' => 'active']);
        Attendance::where('deployment_id', $this->dep->id)->delete();
        $this->company = Company::findOrFail($this->dep->company_id);
        $this->company->update(['latitude' => self::LAT, 'longitude' => self::LNG]);
        $this->intern = User::findOrFail($this->dep->intern_id);
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC')); // 9:00 AM in Manila
        Sanctum::actingAs($this->intern);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function punch(string $which, float $lat, float $lng, array $extra = [])
    {
        return $this->post("/api/intern/attendance/{$which}", [
            'selfie' => UploadedFile::fake()->image('s.png'), 'latitude' => $lat, 'longitude' => $lng,
        ] + $extra, ['Accept' => 'application/json']);
    }

    private function pastPunch(string $day, string $in, string $out, float $lat, float $lng, string $session = 'full'): Attendance
    {
        return Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => $day, 'session' => $session,
            'clock_in' => "{$day} {$in}", 'clock_out' => "{$day} {$out}", 'status' => 'approved',
            'clock_in_latitude' => $lat, 'clock_in_longitude' => $lng, 'clock_out_latitude' => $lat, 'clock_out_longitude' => $lng,
        ]);
    }

    public function test_the_distance_is_measured_in_metres(): void
    {
        $d = AttendanceLocationService::metersBetween(self::LAT, self::LNG, self::LAT + 0.001, self::LNG);
        $this->assertEqualsWithDelta(111, $d, 2);
    }

    // ---- anywhere is fine ----------------------------------------------------------------------

    public function test_an_intern_can_clock_in_far_from_the_company_and_it_is_only_flagged_for_review(): void
    {
        // About 111 km from the company, a field assignment.
        $this->punch('clock-in', self::LAT + 1.0, self::LNG, ['accuracy' => 12, 'fix_age' => 3])->assertSuccessful();

        $a = Attendance::where('deployment_id', $this->dep->id)->firstOrFail();
        $this->assertEqualsWithDelta(111000, $a->clock_in_distance_m, 500);
        $this->assertSame(12, $a->clock_in_accuracy_m);
        // The pin is set, so far away is a warning for the supervisor (never a refusal).
        $this->assertSame(['outside_area'], $a->clock_in_location_flags);
        $this->assertTrue($a->red_flag);
    }

    public function test_a_company_without_a_map_location_is_not_blocked(): void
    {
        $this->company->update(['latitude' => null, 'longitude' => null]);

        $this->punch('clock-in', 14.5, 121.5, ['accuracy' => 8])->assertSuccessful();
        $this->assertNull(Attendance::firstOrFail()->clock_in_distance_m);
    }

    // ---- forged locations are refused ----------------------------------------------------------

    public function test_altered_location_functions_are_refused(): void
    {
        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 10, 'geo_tampered' => 1])
            ->assertStatus(422)->assertJson(['code' => 'location_fake']);
        $this->assertSame(0, Attendance::count());
    }

    public function test_a_believable_trip_between_punches_is_fine(): void
    {
        // The last shift ended 17 hours ago; 111 km in 17 hours is an ordinary journey.
        $this->pastPunch('2026-10-13', '00:00:00', '08:00:00', self::LAT, self::LNG);

        $this->punch('clock-in', self::LAT + 1.0, self::LNG, ['accuracy' => 10])->assertSuccessful();
    }

    public function test_teleporting_between_punches_is_refused(): void
    {
        // It is 12:01 AM in Manila. The last punch was at 11:41 PM the night before, 1000 km from here.
        Carbon::setTestNow(Carbon::parse('2026-10-13 16:01:00', 'UTC'));
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-10-13', 'session' => 'full',
            'clock_in' => '2026-10-13 15:40:00', 'clock_out' => '2026-10-13 15:41:00', 'status' => 'approved',
            'clock_in_latitude' => self::LAT + 9.0, 'clock_in_longitude' => self::LNG,
            'clock_out_latitude' => self::LAT + 9.0, 'clock_out_longitude' => self::LNG,
        ]);

        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 10])->assertStatus(422)->assertJson(['code' => 'location_fake']);
    }

    public function test_the_same_distance_is_fine_when_enough_time_has_passed(): void
    {
        // The same 1000 km jump, but the last punch was two days ago.
        $this->pastPunch('2026-10-12', '00:00:00', '08:00:00', self::LAT + 9.0, self::LNG);

        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 10])->assertSuccessful();
    }

    public function test_a_stale_or_very_imprecise_fix_is_refused(): void
    {
        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 10, 'fix_age' => 600])->assertStatus(422)->assertJson(['code' => 'location_old']);
        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 900, 'fix_age' => 2])->assertStatus(422)->assertJson(['code' => 'location_weak']);
        $this->assertSame(0, Attendance::count());
    }

    // ---- patterns that are flagged, not refused ------------------------------------------------

    public function test_a_perfect_accuracy_is_flagged_not_refused(): void
    {
        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 1])->assertSuccessful();

        $this->assertSame(['perfect_accuracy'], Attendance::firstOrFail()->clock_in_location_flags);
    }

    public function test_the_same_exact_coordinates_at_gps_accuracy_are_flagged(): void
    {
        foreach (['2026-10-10', '2026-10-11'] as $day) {
            $this->pastPunch($day, '00:00:00', '08:00:00', self::LAT + 0.0003, self::LNG);
        }

        $this->punch('clock-in', self::LAT + 0.0003, self::LNG, ['accuracy' => 5])->assertSuccessful();

        $today = Attendance::where('attendance_date', '2026-10-14')->firstOrFail();
        $this->assertSame(['repeated_coordinates'], $today->clock_in_location_flags);
    }

    public function test_the_same_coordinates_at_wifi_accuracy_are_not_flagged(): void
    {
        foreach (['2026-10-10', '2026-10-11'] as $day) {
            $this->pastPunch($day, '00:00:00', '08:00:00', self::LAT + 0.0003, self::LNG);
        }

        // Wi-Fi positioning returns the same spot every time; that proves nothing.
        $this->punch('clock-in', self::LAT + 0.0003, self::LNG, ['accuracy' => 80])->assertSuccessful();

        $this->assertNull(Attendance::where('attendance_date', '2026-10-14')->firstOrFail()->clock_in_location_flags);
    }

    public function test_a_time_out_far_away_is_fine_but_altered_functions_are_flagged(): void
    {
        $this->punch('clock-in', self::LAT, self::LNG, ['accuracy' => 9])->assertSuccessful();
        Carbon::setTestNow(now()->addHours(7)); // before the 8-hour automatic time-out

        // 111 m away is inside the 200 m circle; and a time-out is never refused, only flagged.
        $this->punch('clock-out', self::LAT + 0.0010, self::LNG, ['accuracy' => 9, 'geo_tampered' => 1])->assertSuccessful();

        $a = Attendance::firstOrFail();
        $this->assertNotNull($a->clock_out);
        $this->assertSame(['location_tampering'], $a->clock_out_location_flags);
    }

    public function test_an_offline_entry_is_saved_and_flagged_not_refused(): void
    {
        $this->punch('clock-in', self::LAT, self::LNG, [
            'accuracy' => 10, 'geo_tampered' => 1, 'is_offline' => 1,
            'device_time' => now()->subMinutes(30)->toIso8601String(), 'device_now' => now()->toIso8601String(),
        ])->assertSuccessful();

        $this->assertContains('location_tampering', Attendance::firstOrFail()->clock_in_location_flags);
    }

    public function test_a_supervisor_sees_the_distance_and_flags(): void
    {
        $this->punch('clock-in', self::LAT + 0.0005, self::LNG, ['accuracy' => 1])->assertSuccessful();
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());

        $row = collect($this->getJson('/api/supervisor/attendance')->json('records'))->first();
        $this->assertEqualsWithDelta(56, $row['clock_in_distance_m'], 2);
        $this->assertSame(['perfect_accuracy'], $row['location_flags']);
    }
}
