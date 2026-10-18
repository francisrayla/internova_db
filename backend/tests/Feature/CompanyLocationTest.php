<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
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
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * The company's map pin and radius are set ONLY by its supervisors. A punch outside the circle is a red flag
 * for review ('outside_area'); it is never refused.
 */
class CompanyLocationTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private Company $company;
    private User $supA;
    private User $supB;
    private User $coordinator;
    private User $intern;

    private const LAT = 13.25;
    private const LNG = 121.5;

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
        $this->company->update(['latitude' => null, 'longitude' => null, 'allowed_radius_meters' => null]);
        $this->supA = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->supB = $this->makeSupervisor('second@internova.test', $this->company->id);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
        Notification::query()->delete();
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC')); // 9:00 AM in Manila
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeSupervisor(string $email, int $companyId): User
    {
        $u = User::create([
            'name' => 'Sup ' . $email, 'email' => $email, 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Sup', 'last_name' => 'Two', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $u->id, 'school_id' => $this->dep->school_id, 'company_id' => $companyId]);

        return $u;
    }

    private function pin(array $extra = [])
    {
        return $this->putJson('/api/supervisor/company-location', $extra + ['latitude' => self::LAT, 'longitude' => self::LNG]);
    }

    private function punch(string $which, float $lat, float $lng, array $extra = [])
    {
        return $this->post("/api/intern/attendance/{$which}", $extra + [
            'selfie' => UploadedFile::fake()->image('s.png'), 'latitude' => $lat, 'longitude' => $lng, 'accuracy' => 10, 'fix_age' => 3,
        ], ['Accept' => 'application/json']);
    }

    // ---- supervisor API -----------------------------------------------------------------------

    public function test_a_supervisor_reads_nulls_before_a_pin_is_set(): void
    {
        Sanctum::actingAs($this->supA);

        $this->getJson('/api/supervisor/company-location')->assertOk()
            ->assertJsonPath('location.location_set', false)
            ->assertJsonPath('location.latitude', null)
            ->assertJsonPath('location.allowed_radius_meters', null)
            ->assertJsonPath('location.location_set_by', null)
            ->assertJsonPath('company.id', $this->company->id);
    }

    public function test_a_supervisor_sets_the_pin_with_the_default_radius_and_it_records_who_and_when(): void
    {
        Sanctum::actingAs($this->supA);

        $this->pin(['accuracy_m' => 12])->assertOk()
            ->assertJsonPath('location.location_set', true)
            ->assertJsonPath('location.allowed_radius_meters', 200)
            ->assertJsonPath('location.location_set_by', $this->supA->name);

        $c = $this->company->fresh();
        $this->assertEqualsWithDelta(self::LAT, $c->latitude, 0.0000001);
        $this->assertSame($this->supA->id, $c->location_set_by);
        $this->assertNotNull($c->location_set_at);

        $this->getJson('/api/supervisor/company-location')->assertOk()
            ->assertJsonPath('location.location_set_by', $this->supA->name)
            ->assertJsonPath('location.latitude', self::LAT);
    }

    public function test_the_second_supervisor_of_the_company_can_change_it_and_the_radius_is_kept(): void
    {
        Sanctum::actingAs($this->supA);
        $this->pin(['allowed_radius_meters' => 350])->assertOk();

        Sanctum::actingAs($this->supB);
        $this->putJson('/api/supervisor/company-location', ['latitude' => 13.001, 'longitude' => 121.001])->assertOk()
            ->assertJsonPath('location.allowed_radius_meters', 350)
            ->assertJsonPath('location.location_set_by', $this->supB->name);
        $this->assertSame($this->supB->id, $this->company->fresh()->location_set_by);
    }

    public function test_validation_ranges(): void
    {
        Sanctum::actingAs($this->supA);

        $this->pin(['latitude' => 91])->assertStatus(422)->assertJsonValidationErrors('latitude');
        $this->pin(['latitude' => -90.5])->assertStatus(422)->assertJsonValidationErrors('latitude');
        $this->pin(['longitude' => 181])->assertStatus(422)->assertJsonValidationErrors('longitude');
        $this->pin(['allowed_radius_meters' => 49])->assertStatus(422)->assertJsonValidationErrors('allowed_radius_meters');
        $this->pin(['allowed_radius_meters' => 1001])->assertStatus(422)->assertJsonValidationErrors('allowed_radius_meters');
        $this->pin(['allowed_radius_meters' => 'wide'])->assertStatus(422)->assertJsonValidationErrors('allowed_radius_meters');
        $this->pin(['accuracy_m' => -1])->assertStatus(422)->assertJsonValidationErrors('accuracy_m');
        $this->pin(['accuracy_m' => 5001])->assertStatus(422)->assertJsonValidationErrors('accuracy_m');
        $this->putJson('/api/supervisor/company-location', ['longitude' => 121])->assertStatus(422)->assertJsonValidationErrors('latitude');
        $this->assertNull($this->company->fresh()->latitude);

        $this->pin(['allowed_radius_meters' => 50])->assertOk();
        $this->pin(['allowed_radius_meters' => 1000])->assertOk();
        $this->putJson('/api/supervisor/company-location', ['latitude' => -90, 'longitude' => -180])->assertOk();
    }

    public function test_a_rough_gps_reading_is_refused_so_a_bad_pin_is_not_saved(): void
    {
        Sanctum::actingAs($this->supA);

        $this->pin(['accuracy_m' => 100])->assertOk(); // exactly at the limit is fine
        Company::whereKey($this->company->id)->update(["latitude" => null, "longitude" => null]);

        $this->pin(['accuracy_m' => 142.4])->assertStatus(422)
            ->assertJsonPath('message', 'Your GPS reading is too rough (±142 m). Step outside or wait a moment, then try again.');
        $this->assertNull($this->company->fresh()->latitude);
    }

    public function test_it_only_ever_touches_the_supervisors_own_company(): void
    {
        $other = $this->makeOtherSchool('zeta');
        $sameSchoolOther = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-77', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $before = [$other['company']->fresh()->only(['latitude', 'longitude']), $sameSchoolOther->fresh()->only(['latitude', 'longitude'])];

        Sanctum::actingAs($this->supA);
        // A company id in the body is ignored: there is no way to name another company.
        $this->pin(['company_id' => $other['company']->id, 'id' => $sameSchoolOther->id])->assertOk();

        $this->assertEquals($before, [$other['company']->fresh()->only(['latitude', 'longitude']), $sameSchoolOther->fresh()->only(['latitude', 'longitude'])]);
        $this->assertNotNull($this->company->fresh()->location_set_at);

        // The other school's supervisor sees and changes only their own company.
        Sanctum::actingAs($other['supervisor']);
        $this->getJson('/api/supervisor/company-location')->assertOk()->assertJsonPath('company.id', $other['company']->id);
        $this->pin()->assertOk();
        $this->assertSame($other['supervisor']->id, $other['company']->fresh()->location_set_by);
        $this->assertSame($this->supA->id, $this->company->fresh()->location_set_by);
    }

    public function test_only_a_supervisor_may_use_it(): void
    {
        $dean = User::where('email', 'dean@internova.test')->firstOrFail();
        foreach ([$this->coordinator, $this->intern, $dean] as $user) {
            Sanctum::actingAs($user);
            $this->getJson('/api/supervisor/company-location')->assertForbidden();
            $this->pin()->assertForbidden();
        }
        $this->assertNull($this->company->fresh()->latitude);
    }

    public function test_setting_it_logs_the_change_and_tells_the_other_supervisors_and_the_coordinator(): void
    {
        Sanctum::actingAs($this->supA);
        $this->pin(['allowed_radius_meters' => 150])->assertOk();

        $this->assertTrue(ActivityLog::where('action', 'Set company location')->where('school_id', $this->company->school_id)->exists());
        $toB = Notification::where('user_id', $this->supB->id)->where('type', 'company_location')->get();
        $this->assertCount(1, $toB);
        $this->assertSame('Company location set', $toB->first()->title);
        $this->assertSame(0, Notification::where('user_id', $this->supA->id)->count(), 'the one who set it is not told');
        $this->assertSame(1, Notification::where('audience_role', 'coordinator')->where('school_id', $this->company->school_id)->where('type', 'company_location')->count());

        // Saving the very same pin again is not news.
        $this->pin(['allowed_radius_meters' => 150])->assertOk();
        $this->assertSame(1, Notification::where('type', 'company_location')->where('user_id', $this->supB->id)->count());

        // A real change is.
        $this->pin(['allowed_radius_meters' => 300])->assertOk();
        $this->assertTrue(ActivityLog::where('action', 'Changed company location')->exists());
        $this->assertSame(2, Notification::where('type', 'company_location')->where('user_id', $this->supB->id)->count());
    }

    public function test_the_supervisor_dashboard_says_whether_the_company_has_a_pin(): void
    {
        Sanctum::actingAs($this->supA);
        $this->getJson('/api/supervisor/dashboard')->assertOk()->assertJsonPath('company_location_set', false);

        $this->pin()->assertOk();
        $this->getJson('/api/supervisor/dashboard')->assertOk()->assertJsonPath('company_location_set', true);
    }

    // ---- coordinator: read-only ---------------------------------------------------------------

    public function test_the_coordinator_sees_the_pin_read_only_in_the_company_payloads(): void
    {
        Sanctum::actingAs($this->coordinator);
        $row = fn () => collect($this->getJson('/api/coordinator/companies')->json('companies'))->firstWhere('id', $this->company->id);

        $this->assertFalse($row()['location_set']);
        $this->assertNull($row()['location_set_by']);

        Sanctum::actingAs($this->supA);
        $this->pin(['allowed_radius_meters' => 250])->assertOk();

        Sanctum::actingAs($this->coordinator);
        $this->assertTrue($row()['location_set']);
        $this->assertSame(250, $row()['allowed_radius_meters']);
        $this->assertSame($this->supA->name, $row()['location_set_by']);
        $this->assertNotNull($row()['location_set_at']);

        $this->getJson("/api/coordinator/companies/{$this->company->id}")->assertOk()
            ->assertJsonPath('company.location_set', true)
            ->assertJsonPath('company.allowed_radius_meters', 250)
            ->assertJsonPath('company.location_set_by', $this->supA->name)
            ->assertJsonPath('company.latitude', self::LAT);
    }

    public function test_the_coordinator_cannot_set_the_pin_through_the_company_api(): void
    {
        Sanctum::actingAs($this->coordinator);
        $extra = ['latitude' => 10.5, 'longitude' => 120.5, 'allowed_radius_meters' => 900, 'location_set_by' => $this->coordinator->id, 'location_set_at' => '2026-01-01 00:00:00'];

        $this->patchJson("/api/coordinator/companies/{$this->company->id}", ['company_name' => 'Renamed Corp'] + $extra)->assertOk();
        $c = $this->company->fresh();
        $this->assertSame('Renamed Corp', $c->company_name);
        $this->assertNull($c->latitude);
        $this->assertNull($c->longitude);
        $this->assertNull($c->allowed_radius_meters);
        $this->assertNull($c->location_set_by);
        $this->assertNull($c->location_set_at);

        $made = $this->postJson('/api/coordinator/companies', ['company_name' => 'Fresh Corp'] + $extra)->assertOk()->json('company.id');
        $new = Company::findOrFail($made);
        $this->assertNull($new->latitude);
        $this->assertNull($new->allowed_radius_meters);
        $this->assertNull($new->location_set_by);

        // And there is no coordinator route for the location itself.
        $this->putJson('/api/coordinator/company-location', ['latitude' => 1, 'longitude' => 1])->assertStatus(404);
    }

    // ---- attendance: outside the circle is a red flag, never a refusal ------------------------

    private function pinned(int $radius = 200): void
    {
        $this->company->update(['latitude' => self::LAT, 'longitude' => self::LNG, 'allowed_radius_meters' => $radius]);
        Sanctum::actingAs($this->intern);
    }

    public function test_inside_the_radius_is_not_flagged(): void
    {
        $this->pinned();
        $this->punch('clock-in', self::LAT + 0.0010, self::LNG)->assertSuccessful(); // ~111 m

        $a = Attendance::firstOrFail();
        $this->assertEqualsWithDelta(111, $a->clock_in_distance_m, 2);
        $this->assertNull($a->clock_in_location_flags);
        $this->assertFalse($a->red_flag);
    }

    public function test_outside_the_radius_is_saved_red_flagged_and_labelled_with_the_distance(): void
    {
        $this->pinned();
        $this->punch('clock-in', self::LAT + 0.0032, self::LNG)->assertSuccessful()->assertJson(['success' => true]); // ~355 m

        $a = Attendance::firstOrFail();
        $this->assertSame(['outside_area'], $a->clock_in_location_flags);
        $this->assertTrue($a->red_flag);
        $this->assertNull($a->red_flag_checked_at);
        $this->assertMatchesRegularExpression('/^Outside the company area \(3\d\d m away\)$/', $a->outsideAreaLabel());
        $this->assertMatchesRegularExpression('/^Red flag: outside the company area \(3\d\d m away\)$/', $a->redFlagText());

        Sanctum::actingAs($this->supA);
        $row = collect($this->getJson('/api/supervisor/attendance')->json('records'))->first();
        $this->assertTrue($row['red_flag']);
        $this->assertContains('outside_area', $row['location_flags']);
        $this->assertStringStartsWith('Outside the company area (', $row['outside_area_label']);
        $this->assertEqualsWithDelta(355, $row['clock_in_distance_m'], 3);
    }

    public function test_the_fixs_own_accuracy_is_forgiven_but_only_up_to_100_m(): void
    {
        $this->pinned(); // radius 200
        // ~222 m away: outside 200 m, but inside 200 + 60 m of reported error.
        $this->punch('clock-in', self::LAT + 0.0020, self::LNG, ['accuracy' => 60])->assertSuccessful();
        $this->assertNull(Attendance::firstOrFail()->clock_in_location_flags);
        $this->assertFalse(Attendance::firstOrFail()->red_flag);

        Attendance::query()->delete();
        // ~333 m away with a 90 m error: 200 + 90 = 290 < 333, flagged.
        $this->punch('clock-in', self::LAT + 0.0030, self::LNG, ['accuracy' => 90])->assertSuccessful();
        $this->assertSame(['outside_area'], Attendance::firstOrFail()->clock_in_location_flags);

        Attendance::query()->delete();
        // ~345 m away with a 200 m error: the tolerance is capped at 100 m, so 300 m is the limit and this is flagged.
        $this->punch('clock-in', self::LAT + 0.0031, self::LNG, ['accuracy' => 200])->assertSuccessful();
        $this->assertSame(['outside_area'], Attendance::firstOrFail()->clock_in_location_flags);

        Attendance::query()->delete();
        // ~278 m with a 200 m error is inside 200 + 100.
        $this->punch('clock-in', self::LAT + 0.0025, self::LNG, ['accuracy' => 200])->assertSuccessful();
        $this->assertNull(Attendance::firstOrFail()->clock_in_location_flags);
    }

    public function test_the_radius_is_the_companys_own(): void
    {
        $this->pinned(1000);
        $this->punch('clock-in', self::LAT + 0.0080, self::LNG)->assertSuccessful(); // ~890 m, inside 1000 m
        $this->assertNull(Attendance::firstOrFail()->clock_in_location_flags);
    }

    public function test_without_a_pin_there_is_no_distance_check(): void
    {
        Sanctum::actingAs($this->intern);
        $this->punch('clock-in', 14.9, 121.9)->assertSuccessful();

        $a = Attendance::firstOrFail();
        $this->assertNull($a->clock_in_distance_m);
        $this->assertNull($a->clock_in_location_flags);
        $this->assertFalse($a->red_flag);
        $this->assertNull($a->outsideAreaLabel());
    }

    public function test_a_time_out_outside_the_circle_is_flagged_and_unchecks_an_older_check(): void
    {
        $this->pinned();
        $this->punch('clock-in', self::LAT, self::LNG)->assertSuccessful();
        $a = Attendance::firstOrFail();
        $a->update(['clock_in_odd_hours' => true, 'red_flag_checked_by' => $this->supA->id, 'red_flag_checked_at' => now()]);

        Carbon::setTestNow(now()->addHours(7));
        $this->punch('clock-out', self::LAT + 0.0040, self::LNG)->assertSuccessful(); // never refused

        $a->refresh();
        $this->assertNotNull($a->clock_out);
        $this->assertSame(['outside_area'], $a->clock_out_location_flags);
        $this->assertTrue($a->red_flag);
        $this->assertNull($a->red_flag_checked_at);
        $this->assertStringContainsString('away)', $a->outsideAreaLabel());
    }

    public function test_an_offline_entry_outside_the_circle_is_saved_and_flagged(): void
    {
        $this->pinned();
        $this->punch('clock-in', self::LAT + 0.0050, self::LNG, [
            'is_offline' => 1, 'device_time' => now()->subMinutes(30)->toIso8601String(), 'device_now' => now()->toIso8601String(),
        ])->assertSuccessful();

        $a = Attendance::firstOrFail();
        $this->assertSame(['outside_area'], $a->clock_in_location_flags);
        $this->assertTrue($a->red_flag);
    }
}
