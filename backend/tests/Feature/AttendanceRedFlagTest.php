<?php

namespace Tests\Feature;

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
 * An intern who clocks in at an odd hour (at or after 5:00 PM, or before 5:00 AM, Philippine time) gets a red flag
 * on that record and every active supervisor of the company is told right away (nobody else is). Flagged records
 * lead the supervisor's list until a supervisor marks them as checked; the lists can be filtered and searched by
 * intern name on the server.
 */
class AttendanceRedFlagTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;
    private User $supA;
    private User $supB;
    private User $stranger;

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
        Notification::query()->delete();
        $this->intern = User::findOrFail($this->dep->intern_id);
        $this->supA = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->supB = $this->makeSupervisor('second@internova.test', 'Onyok', 'Padilla', $this->dep->company_id);
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $this->stranger = $this->makeSupervisor('stranger@internova.test', 'Ana', 'Reyes', $other->id);
        $this->at('2026-10-14 01:00:00'); // 9:00 AM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** The server clock, in UTC. */
    private function at(string $utc): void
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));
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

    private function clockIn(array $extra = [])
    {
        Sanctum::actingAs($this->intern);

        return $this->post('/api/intern/attendance/clock-in', [
            'selfie' => UploadedFile::fake()->image('s.png'), 'latitude' => 13.0, 'longitude' => 121.0, 'accuracy' => 12, 'fix_age' => 3,
        ] + $extra, ['Accept' => 'application/json']);
    }

    private function row(string $day, string $in, array $extra = []): Attendance
    {
        return Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => $day, 'session' => 'full',
            'clock_in' => "$day $in", 'clock_out' => "$day 09:00:00", 'status' => 'approved',
        ] + $extra);
    }

    // ---- the rule ----------------------------------------------------------------------------------

    public function test_the_odd_hours_window_in_manila_time(): void
    {
        // UTC hour + 8 = Manila hour.
        $cases = [
            '2026-10-14 08:59:00' => false, // 4:59 PM
            '2026-10-14 09:00:00' => true,  // 5:00 PM
            '2026-10-14 10:12:00' => true,  // 6:12 PM
            '2026-10-14 20:59:00' => true,  // 4:59 AM next day
            '2026-10-14 21:00:00' => false, // 5:00 AM
            '2026-10-14 01:00:00' => false, // 9:00 AM
            '2026-10-14 04:30:00' => false, // 12:30 PM
        ];
        foreach ($cases as $utc => $odd) {
            $this->assertSame($odd, Attendance::isOddHour(Carbon::parse($utc, 'UTC')), $utc);
        }
    }

    // ---- flag + notification on clock-in -------------------------------------------------------------

    public function test_a_clock_in_at_6_12_pm_is_flagged_and_every_company_supervisor_is_told(): void
    {
        $this->at('2026-10-14 10:12:00'); // 6:12 PM in Manila
        $this->clockIn()->assertSuccessful();

        $a = Attendance::firstOrFail();
        $this->assertTrue($a->clock_in_odd_hours);
        $this->assertTrue($a->red_flag);
        $this->assertNull($a->red_flag_checked_at);
        $this->assertSame('Red flag: clocked in at 6:12 PM', $a->redFlagText());

        $rows = Notification::where('type', 'attendance_red_flag')->get();
        $this->assertCount(2, $rows, 'one row per active supervisor of the company');
        $this->assertEqualsCanonicalizing([$this->supA->id, $this->supB->id], $rows->pluck('user_id')->all());
        $this->assertSame(['supervisor'], $rows->pluck('audience_role')->unique()->all());
        $first = $rows->first();
        $this->assertStringContainsString($this->intern->first_name, $first->body);
        $this->assertStringContainsString('6:12 PM', $first->body);
        $this->assertSame('/supervisor/attendance?flag=unchecked', $first->link);
        $this->assertTrue((bool) $first->important);
    }

    public function test_the_dean_the_coordinator_and_other_companies_are_not_notified(): void
    {
        $this->at('2026-10-14 10:12:00');
        $this->clockIn()->assertSuccessful();

        $this->assertSame(0, Notification::where('type', 'attendance_red_flag')->whereIn('audience_role', ['dean', 'coordinator', 'intern', 'superadmin'])->count());
        $this->assertSame(0, Notification::where('type', 'attendance_red_flag')->where('user_id', $this->stranger->id)->count());
    }

    public function test_a_normal_clock_in_is_not_flagged_and_nobody_is_told(): void
    {
        $this->clockIn()->assertSuccessful(); // 9:00 AM

        $a = Attendance::firstOrFail();
        $this->assertFalse($a->clock_in_odd_hours);
        $this->assertFalse($a->red_flag);
        $this->assertNull($a->redFlagText());
        $this->assertSame(0, Notification::where('type', 'attendance_red_flag')->count());
    }

    public function test_an_early_morning_clock_in_is_flagged_too(): void
    {
        $this->at('2026-10-13 20:30:00'); // 4:30 AM Oct 14 in Manila
        $this->clockIn()->assertSuccessful();

        $this->assertTrue(Attendance::firstOrFail()->red_flag);
    }

    public function test_an_offline_entry_is_judged_by_the_time_it_really_happened_not_by_when_it_synced(): void
    {
        // Captured at 6:12 PM Manila the evening before; the phone reaches the server at 9:00 AM.
        $this->clockIn([
            'is_offline' => 1, 'device_time' => '2026-10-13T10:12:00Z', 'device_now' => '2026-10-14T01:00:00Z',
        ])->assertSuccessful();

        $a = Attendance::firstOrFail();
        $this->assertTrue($a->clock_in_is_offline);
        $this->assertTrue($a->red_flag);
        $this->assertSame('2026-10-13', $a->attendance_date->toDateString());
        $this->assertSame('Red flag: clocked in at 6:12 PM', $a->redFlagText());
        $body = Notification::where('type', 'attendance_red_flag')->firstOrFail()->body;
        $this->assertStringContainsString('6:12 PM', $body);
        $this->assertStringContainsString('offline', $body);
    }

    public function test_an_offline_entry_taken_in_the_morning_but_synced_in_the_evening_is_not_flagged(): void
    {
        $this->at('2026-10-14 10:30:00'); // syncs at 6:30 PM
        $this->clockIn([
            'is_offline' => 1, 'device_time' => '2026-10-14T00:05:00Z', 'device_now' => '2026-10-14T10:30:00Z', // taken 8:05 AM
        ])->assertSuccessful();

        $this->assertFalse(Attendance::firstOrFail()->red_flag);
        $this->assertSame(0, Notification::where('type', 'attendance_red_flag')->count());
    }

    public function test_red_location_flags_make_a_red_flag_but_soft_ones_do_not(): void
    {
        $soft = $this->row('2026-10-01', '01:00:00', ['clock_in_location_flags' => ['weak_signal', 'repeated_coordinates']]);
        $red = $this->row('2026-10-02', '01:00:00', ['clock_in_location_flags' => ['impossible_travel']]);
        $out = $this->row('2026-10-03', '01:00:00', ['clock_out_location_flags' => ['location_tampering']]);

        $this->assertFalse($soft->fresh()->red_flag);
        $this->assertTrue($red->fresh()->red_flag);
        $this->assertTrue($out->fresh()->red_flag);
        $this->assertSame('Red flag: suspicious location', $red->fresh()->redFlagText());
    }

    // ---- supervisor list: pinned first, checking, filters, search -------------------------------------

    public function test_unchecked_red_flags_lead_the_supervisors_list_then_the_usual_date_order(): void
    {
        $oldFlag = $this->row('2026-10-01', '10:00:00', ['clock_in_odd_hours' => true]);
        $newer = $this->row('2026-10-12', '01:00:00');
        $newest = $this->row('2026-10-13', '01:00:00');

        Sanctum::actingAs($this->supA);
        $ids = collect($this->getJson('/api/supervisor/attendance')->assertOk()->json('records'))->pluck('id')->all();
        $this->assertSame([$oldFlag->id, $newest->id, $newer->id], $ids);

        // After a supervisor checks it, it goes back to its place by date but keeps the red badge.
        $this->patchJson("/api/supervisor/attendance/{$oldFlag->id}/red-flag")->assertOk();
        $records = collect($this->getJson('/api/supervisor/attendance')->assertOk()->json('records'));
        $this->assertSame([$newest->id, $newer->id, $oldFlag->id], $records->pluck('id')->all());
        $checked = $records->firstWhere('id', $oldFlag->id);
        $this->assertTrue($checked['red_flag']);
        $this->assertTrue($checked['red_flag_checked']);
        $this->assertSame($this->supA->name, $checked['red_flag_checked_by']);
        $this->assertNotNull($checked['red_flag_checked_at']);
        $this->assertStringStartsWith('Red flag: clocked in at', $checked['red_flag_text']);
        $this->assertNotNull($oldFlag->fresh()->red_flag_checked_at);
        $this->assertSame($this->supA->id, $oldFlag->fresh()->red_flag_checked_by);
    }

    public function test_the_red_flag_filters(): void
    {
        $unchecked = $this->row('2026-10-01', '10:00:00', ['clock_in_odd_hours' => true]);
        $checked = $this->row('2026-10-02', '10:00:00', ['clock_in_odd_hours' => true, 'red_flag_checked_by' => $this->supA->id, 'red_flag_checked_at' => now()]);
        $location = $this->row('2026-10-03', '01:00:00', ['clock_in_location_flags' => ['location_tampering']]);
        $this->row('2026-10-04', '01:00:00');

        Sanctum::actingAs($this->supA);
        $ids = fn (string $q) => collect($this->getJson("/api/supervisor/attendance{$q}")->assertOk()->json('records'))->pluck('id')->sort()->values()->all();
        $this->assertCount(4, $ids(''));
        $this->assertSame([$unchecked->id, $checked->id, $location->id], $ids('?flag=red'));
        $this->assertSame([$unchecked->id, $location->id], $ids('?flag=unchecked'));
        // Combines with the status filter.
        $this->assertSame([], $ids('?flag=red&status=pending'));
    }

    public function test_only_the_companys_supervisors_can_mark_a_flag_checked_and_only_flagged_records(): void
    {
        $flagged = $this->row('2026-10-01', '10:00:00', ['clock_in_odd_hours' => true]);
        $plain = $this->row('2026-10-02', '01:00:00');

        Sanctum::actingAs($this->stranger);
        $this->patchJson("/api/supervisor/attendance/{$flagged->id}/red-flag")->assertNotFound();
        $this->assertNull($flagged->fresh()->red_flag_checked_at);

        Sanctum::actingAs($this->supB); // the other supervisor of the same company
        $this->patchJson("/api/supervisor/attendance/{$plain->id}/red-flag")->assertStatus(422);
        $this->patchJson("/api/supervisor/attendance/{$flagged->id}/red-flag")->assertOk();
        $this->assertSame($this->supB->id, $flagged->fresh()->red_flag_checked_by);
    }

    public function test_a_later_red_location_flag_on_the_time_out_unchecks_a_checked_record(): void
    {
        $this->clockIn()->assertSuccessful(); // 9 AM: no flag
        $a = Attendance::firstOrFail();
        $a->update(['clock_in_odd_hours' => true, 'red_flag_checked_by' => $this->supA->id, 'red_flag_checked_at' => now()]);

        $this->at('2026-10-14 08:00:00');
        Sanctum::actingAs($this->intern);
        $this->post('/api/intern/attendance/clock-out', [
            'selfie' => UploadedFile::fake()->image('o.png'), 'latitude' => 13.0, 'longitude' => 121.0, 'accuracy' => 12, 'geo_tampered' => 1,
        ], ['Accept' => 'application/json'])->assertSuccessful();

        $a->refresh();
        $this->assertTrue($a->red_flag);
        $this->assertNull($a->red_flag_checked_at, 'new red news is not hidden by an older check');
    }

    public function test_the_supervisor_search_is_server_side_and_works_with_pagination(): void
    {
        $other = User::create([
            'name' => 'Zed Quiet', 'first_name' => 'Zed', 'last_name' => 'Quiet', 'email' => 'zed@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'intern')->value('id'), 'school_id' => $this->dep->school_id, 'status' => 'active', 'email_verified_at' => now(),
        ]);
        $depZ = InternshipDeployment::create([
            'school_id' => $this->dep->school_id, 'company_id' => $this->dep->company_id, 'intern_id' => $other->id,
            'start_date' => '2026-09-01', 'required_hours' => 500, 'status' => 'active',
        ]);
        for ($i = 1; $i <= 25; $i++) {
            $this->row(Carbon::parse('2026-09-01')->addDays($i)->toDateString(), '01:00:00');
        }
        Attendance::create(['deployment_id' => $depZ->id, 'attendance_date' => '2026-09-02', 'session' => 'full', 'clock_in' => '2026-09-02 01:00:00', 'status' => 'approved']);

        Sanctum::actingAs($this->supA);
        $all = $this->getJson('/api/supervisor/attendance')->assertOk();
        $this->assertTrue($all->json('has_more'));
        $this->assertSame(26, $all->json('total'));

        $res = $this->getJson('/api/supervisor/attendance?search=Zed')->assertOk();
        $this->assertSame(1, $res->json('total'));
        $this->assertSame('Zed Quiet', $res->json('records.0.intern_name'));
        $this->assertFalse($res->json('has_more'));

        // Searches the other interns by their own name, in lower case and by full name.
        $name = $this->intern->first_name;
        $this->assertSame(25, $this->getJson('/api/supervisor/attendance?search=' . urlencode(strtolower($name)))->json('total'));
        $this->assertSame(25, $this->getJson('/api/supervisor/attendance?search=' . urlencode(trim("{$this->intern->first_name} {$this->intern->last_name}")))->json('total'));
        $this->assertSame(0, $this->getJson('/api/supervisor/attendance?search=nobodyhasthisname')->json('total'));
        // A wildcard typed by the user is a plain character, not "match everything".
        $this->assertSame(0, $this->getJson('/api/supervisor/attendance?search=' . urlencode('%'))->json('total'));
    }

    // ---- coordinator + Dean ---------------------------------------------------------------------------

    public function test_the_coordinator_and_dean_see_the_badge_but_get_no_notification(): void
    {
        $this->at('2026-10-14 10:12:00');
        $this->clockIn()->assertSuccessful();
        $a = Attendance::firstOrFail();

        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $rec = $this->getJson("/api/coordinator/attendance?company_id={$this->dep->company_id}")->assertOk()->json('records.0');
        $this->assertTrue($rec['red_flag']);
        $this->assertSame('Red flag: clocked in at 6:12 PM', $rec['red_flag_text']);
        $this->assertFalse($rec['red_flag_checked']);
        $name = $this->intern->first_name;
        $this->assertSame(1, $this->getJson('/api/coordinator/attendance?search=' . urlencode($name))->json('total'));
        $this->assertSame(0, $this->getJson('/api/coordinator/attendance?search=nobodyhasthisname')->json('total'));

        Sanctum::actingAs(User::where('email', 'dean@internova.test')->firstOrFail());
        $d = $this->getJson("/api/dean/interns/{$this->dep->id}")->assertOk()->json('attendance.0');
        $this->assertSame($a->id, $d['id']);
        $this->assertTrue($d['red_flag']);
        $this->assertSame('Red flag: clocked in at 6:12 PM', $d['red_flag_text']);
    }
}
