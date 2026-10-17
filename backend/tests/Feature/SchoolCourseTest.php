<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Company;
use App\Models\CoordinatorProfile;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolCourse;
use App\Models\User;
use App\Services\CourseRequirementService;
use App\Support\Courses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The course catalog (App\Support\Courses) and the courses each school offers (Settings -> Courses offered).
 */
class SchoolCourseTest extends TestCase
{
    use RefreshDatabase;

    private User $coordinator;
    private User $dean;
    private Company $company;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->dean = User::where('email', 'dean@internova.test')->firstOrFail();
        $this->company = Company::where('school_id', $this->coordinator->school_id)->where('status', 'active')->firstOrFail();
    }

    private function internBody(array $over = []): array
    {
        return array_merge([
            'first_name' => 'Maria', 'last_name' => 'Garcia', 'email' => 'maria.garcia.sc@gmail.com',
            'course' => 'BSIT', 'year_level' => '4th Year', 'company_id' => $this->company->id,
            'start_date' => now('Asia/Manila')->toDateString(),
        ], $over);
    }

    private function row(array $over = []): array
    {
        return array_merge(['first_name' => 'Ana', 'last_name' => 'Cruz', 'email' => 'ana.cruz.sc@gmail.com', 'course' => 'BSIT', 'year_level' => '4th Year'], $over);
    }

    private function otherSchoolUser(string $role): User
    {
        $school = School::firstWhere('school_code', 'SCHOOL-X') ?? School::create(['school_code' => 'SCHOOL-X', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'x@o.test', 'contact_number' => '09170000009', 'status' => 'active']);
        $user = User::create([
            'name' => "Other {$role}", 'email' => "other.{$role}@internova.test", 'password' => bcrypt('password'),
            'role_id' => Role::where('name', $role)->first()->id, 'school_id' => $school->id,
            'first_name' => 'Other', 'last_name' => ucfirst($role), 'status' => 'active', 'email_verified_at' => now(),
        ]);
        if ($role === 'coordinator') {
            CoordinatorProfile::create(['user_id' => $user->id, 'school_id' => $school->id, 'is_primary_coordinator' => true]);
        }

        return $user;
    }

    private function offer(array $offered)
    {
        return $this->putJson('/api/coordinator/school-courses', ['offered' => $offered]);
    }

    // ---- catalog ----------------------------------------------------------

    public function test_every_catalog_code_and_name_resolves_and_no_code_collides(): void
    {
        $grouped = [];
        foreach (Courses::GROUPS as $codes) {
            foreach ($codes as $code) {
                $this->assertArrayNotHasKey($code, $grouped, "{$code} is in two groups");
                $grouped[$code] = true;
            }
        }
        $this->assertEqualsCanonicalizing(array_keys(Courses::NAMES), array_keys($grouped));

        $keys = [];
        foreach (Courses::NAMES as $code => $name) {
            $key = strtoupper(preg_replace('/[\s.\-]/', '', $code));
            $this->assertArrayNotHasKey($key, $keys, "{$code} collides with another code");
            $keys[$key] = $code;
            $this->assertCount(1, array_keys(Courses::NAMES, $name), "{$name} has two codes");

            $this->assertSame($name, Courses::canonical($code));
            $this->assertSame($name, Courses::canonical(strtolower($code)));
            $this->assertSame($name, Courses::canonical(' ' . implode('.', str_split(str_replace('-', '', $code))) . '. '));
            $this->assertSame($name, Courses::canonical(str_replace('-', ' ', $code)));
            $this->assertSame($name, Courses::canonical(str_replace('-', '', $code)));
            $this->assertSame($name, Courses::canonical($name));
            $this->assertSame($name, Courses::canonical(strtoupper($name)));
            $this->assertSame($code, Courses::codeFor($name));
        }
    }

    public function test_aliases_and_long_forms_map_to_the_right_course(): void
    {
        $this->assertSame(Courses::NAMES['BTELED'], Courses::canonical('BTLEd'));
        $this->assertSame(Courses::NAMES['BSCRIM'], Courses::canonical('BSCriminology'));
        $this->assertSame(Courses::NAMES['BINDTECH'], Courses::canonical('BIT'));
        $this->assertSame(Courses::NAMES['BSMLS'], Courses::canonical('BSMEDTECH'));
        $this->assertSame(Courses::NAMES['BSIT'], Courses::canonical('BS Information Technology'));
        $this->assertSame(Courses::NAMES['BSIT'], Courses::canonical('B.S. in Information Technology'));
        $this->assertSame(Courses::NAMES['BSAGRI'], Courses::canonical('BS Agriculture'));
        $this->assertSame(Courses::NAMES['BSA'], Courses::canonical('BSA'));
        $this->assertSame(Courses::NAMES['BSA'], Courses::canonical('BS Accountancy'));
        $this->assertSame(Courses::NAMES['BSN'], Courses::canonical('BS Nursing'));
        $this->assertSame(Courses::NAMES['ABCOMM'], Courses::canonical('AB Communication'));
        $this->assertSame(Courses::NAMES['BSED-SS'], Courses::canonical('bsed ss'));
        $this->assertSame(Courses::NAMES['BSBA-HRM'], Courses::canonical('BSBA HRM'));
        $this->assertNotSame(Courses::NAMES['BSBA'], Courses::canonical('BSBA-MM'));
        // Anything else is kept as typed (tidied).
        $this->assertSame('Diploma in Culinary Arts', Courses::canonical('  Diploma   in Culinary  Arts '));
        $this->assertNull(Courses::canonical(null));
        $this->assertSame('', Courses::canonical('  '));
    }

    public function test_default_hours_are_500_except_criminology(): void
    {
        $this->assertSame(250, Courses::defaultHours('BSCRIM'));
        $this->assertSame(250, Courses::defaultHours(Courses::NAMES['BSCRIM']));
        $this->assertSame(500, Courses::defaultHours('BSIT'));
        $this->assertSame(500, Courses::defaultHours('Diploma in Culinary Arts'));
        $this->assertSame(500, Courses::defaultHours(null));
        foreach (Courses::catalog() as $group) {
            foreach ($group['courses'] as $c) {
                $this->assertSame($c['code'] === 'BSCRIM' ? 250 : 500, $c['default_hours']);
            }
        }
    }

    // ---- GET / PUT --------------------------------------------------------

    public function test_coordinator_reads_the_catalog_and_the_offered_list_with_intern_counts(): void
    {
        Sanctum::actingAs($this->coordinator);
        $res = $this->getJson('/api/coordinator/school-courses')->assertOk();

        $this->assertSame(array_keys(Courses::GROUPS), collect($res->json('catalog'))->pluck('label')->all());
        $first = $res->json('catalog.0.courses.0');
        $this->assertSame(['code' => 'BSIT', 'name' => Courses::NAMES['BSIT'], 'default_hours' => 500, 'aliases' => []], $first);
        $this->assertSame(array_map(fn ($c) => Courses::NAMES[$c], Courses::DEFAULT_OFFERED), collect($res->json('offered'))->pluck('name')->all());
        $bsit = collect($res->json('offered'))->firstWhere('code', 'BSIT');
        $this->assertSame(1, $bsit['interns_count']); // the seeded demo intern
        $this->assertNull($bsit['required_hours']);
        $this->assertSame(500, $bsit['hours']);
        $this->assertSame(250, collect($res->json('offered'))->firstWhere('code', 'BSCRIM')['hours']);
    }

    public function test_dean_reads_and_saves_the_same_list_of_their_school(): void
    {
        Sanctum::actingAs($this->dean);
        $this->getJson('/api/dean/school-courses')->assertOk()->assertJsonCount(count(Courses::DEFAULT_OFFERED), 'offered');

        $this->putJson('/api/dean/school-courses', ['offered' => [['name' => 'BSN', 'required_hours' => 600]]])
            ->assertOk()->assertJsonPath('offered.0.name', Courses::NAMES['BSN'])->assertJsonPath('offered.0.hours', 600);

        Sanctum::actingAs($this->coordinator);
        $this->getJson('/api/coordinator/school-courses')->assertOk()->assertJsonCount(1, 'offered')->assertJsonPath('offered.0.required_hours', 600);
    }

    public function test_other_roles_are_refused_on_both_url_groups(): void
    {
        foreach (['supervisor@internova.test', 'intern@internova.test'] as $email) {
            Sanctum::actingAs(User::where('email', $email)->firstOrFail());
            $this->getJson('/api/coordinator/school-courses')->assertStatus(403);
            $this->putJson('/api/coordinator/school-courses', ['offered' => []])->assertStatus(403);
            $this->getJson('/api/dean/school-courses')->assertStatus(403);
            $this->putJson('/api/dean/school-courses', ['offered' => []])->assertStatus(403);
        }
        // A coordinator is not a dean and the other way round.
        Sanctum::actingAs($this->coordinator);
        $this->getJson('/api/dean/school-courses')->assertStatus(403);
        Sanctum::actingAs($this->dean);
        $this->getJson('/api/coordinator/school-courses')->assertStatus(403);
        $this->assertCount(count(Courses::DEFAULT_OFFERED), SchoolCourse::where('school_id', $this->coordinator->school_id)->get());
    }

    public function test_a_new_school_starts_with_the_common_courses_and_keeps_its_own_list(): void
    {
        $school = School::create(['school_code' => 'NEW-1', 'school_name' => 'New College', 'address' => 'Davao', 'contact_email' => 'n@n.test', 'contact_number' => '09170000011', 'status' => 'active']);
        $this->assertSame(array_map(fn ($c) => Courses::NAMES[$c], Courses::DEFAULT_OFFERED), SchoolCourse::where('school_id', $school->id)->orderBy('sort_order')->pluck('name')->all());
        $this->assertSame([null], SchoolCourse::where('school_id', $school->id)->distinct()->pluck('required_hours')->all());

        // Seeding again never touches a school that already has a list (edited or emptied).
        SchoolCourse::where('school_id', $school->id)->where('name', '!=', Courses::NAMES['BSIT'])->delete();
        \App\Services\SchoolCourseService::seedDefaults($school->id);
        $this->assertSame(1, SchoolCourse::where('school_id', $school->id)->count());
    }

    public function test_the_defaults_migration_fills_only_schools_without_courses(): void
    {
        $empty = School::create(['school_code' => 'EMPTY-1', 'school_name' => 'Empty College', 'address' => 'x', 'contact_email' => 'e@e.test', 'contact_number' => '09170000012', 'status' => 'active']);
        SchoolCourse::where('school_id', $empty->id)->delete();
        $own = $this->coordinator->school_id;
        SchoolCourse::where('school_id', $own)->delete();
        SchoolCourse::create(['school_id' => $own, 'name' => Courses::NAMES['BSN'], 'sort_order' => 0]);

        (require database_path('migrations/2026_10_20_000200_default_school_courses.php'))->up();

        $this->assertSame(count(Courses::DEFAULT_OFFERED), SchoolCourse::where('school_id', $empty->id)->count());
        $this->assertSame([Courses::NAMES['BSN']], SchoolCourse::where('school_id', $own)->pluck('name')->all());
    }

    public function test_guests_are_refused(): void
    {
        $this->getJson('/api/coordinator/school-courses')->assertStatus(401);
        $this->putJson('/api/dean/school-courses', ['offered' => []])->assertStatus(401);
    }

    public function test_another_school_sees_and_changes_only_its_own_list(): void
    {
        $other = $this->otherSchoolUser('coordinator');
        Sanctum::actingAs($other);
        // A new school starts with the common courses.
        $this->getJson('/api/coordinator/school-courses')->assertOk()->assertJsonCount(count(Courses::DEFAULT_OFFERED), 'offered');

        $this->offer([['name' => 'BSN', 'required_hours' => null]])->assertOk();
        $this->assertSame(1, SchoolCourse::where('school_id', $other->school_id)->count());
        $this->assertSame(count(Courses::DEFAULT_OFFERED), SchoolCourse::where('school_id', $this->coordinator->school_id)->count());

        Sanctum::actingAs($this->coordinator);
        $this->assertNotContains(Courses::NAMES['BSN'], collect($this->getJson('/api/coordinator/school-courses')->json('offered'))->pluck('name')->all());
    }

    public function test_save_replaces_the_list_canonicalizes_names_and_writes_an_activity_log(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([
            ['name' => 'bsit', 'required_hours' => 486],
            ['name' => 'BS Nursing', 'required_hours' => null],
            ['name' => '  Diploma   in Culinary Arts ', 'required_hours' => 300],
        ])->assertOk()->assertJsonPath('message', 'Courses offered saved.');

        $rows = SchoolCourse::where('school_id', $this->coordinator->school_id)->orderBy('sort_order')->get();
        $this->assertSame([Courses::NAMES['BSIT'], Courses::NAMES['BSN'], 'Diploma in Culinary Arts'], $rows->pluck('name')->all());
        $this->assertSame([486, null, 300], $rows->pluck('required_hours')->all());

        $res = $this->getJson('/api/coordinator/school-courses')->assertOk();
        $this->assertTrue(collect($res->json('offered'))->firstWhere('name', 'Diploma in Culinary Arts')['custom']);
        $this->assertFalse(collect($res->json('offered'))->firstWhere('code', 'BSN')['custom']);

        $log = ActivityLog::where('action', 'Updated courses offered')->where('school_id', $this->coordinator->school_id)->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertStringContainsString('Bachelor of Science in Nursing', $log->description);
        $this->assertSame($this->coordinator->id, $log->user_id);
    }

    public function test_validation_rules(): void
    {
        Sanctum::actingAs($this->coordinator);
        $before = SchoolCourse::count();

        $this->offer([['name' => '', 'required_hours' => null]])->assertStatus(422)->assertJsonValidationErrors('offered.0.name');
        $this->offer([['name' => str_repeat('a', 151)]])->assertStatus(422)->assertJsonValidationErrors('offered.0.name');
        foreach (['<b>x</b>', 'Course; DROP TABLE', 'Pro$gram', 'Emoji 😀', 'a/b'] as $bad) {
            $this->offer([['name' => $bad]])->assertStatus(422)->assertJsonValidationErrors('offered.0.name');
        }
        foreach ([0, 2001, -5, 'abc', 12.5] as $hours) {
            $this->offer([['name' => 'Valid Program', 'required_hours' => $hours]])->assertStatus(422)->assertJsonValidationErrors('offered.0.required_hours');
        }
        $this->putJson('/api/coordinator/school-courses', [])->assertStatus(422)->assertJsonValidationErrors('offered');
        $this->putJson('/api/coordinator/school-courses', ['offered' => 'BSIT'])->assertStatus(422);

        // Duplicates, also when written differently (code vs full name, case, spaces).
        $this->offer([['name' => 'BSIT'], ['name' => Courses::NAMES['BSIT']]])->assertStatus(422)->assertJsonValidationErrors('offered');
        $this->offer([['name' => 'Culinary Arts'], ['name' => 'culinary   arts']])->assertStatus(422)->assertJsonValidationErrors('offered');

        // At most 100.
        $tooMany = array_map(fn ($i) => ['name' => "Program {$i}"], range(1, 101));
        $this->offer($tooMany)->assertStatus(422)->assertJsonValidationErrors('offered');
        $this->offer(array_slice($tooMany, 0, 100))->assertOk();

        $this->assertSame($before - count(Courses::DEFAULT_OFFERED) + 100, SchoolCourse::count());

        // Allowed characters: letters, numbers, spaces and . , & ( ) - '
        $this->offer([['name' => "Diploma in Hotel & Restaurant (HRM), St. Mary's - Night 2"], ['name' => 'Ñandú Programa'], ['name' => 'Hours edge', 'required_hours' => 1], ['name' => 'Hours edge two', 'required_hours' => 2000]])->assertOk();
    }

    public function test_removing_a_course_interns_have_is_allowed_and_they_keep_it(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([['name' => 'BSN']])->assertOk()
            ->assertJsonPath('offered.0.interns_count', 0)
            ->assertJsonPath('unlisted.0.name', Courses::NAMES['BSIT'])
            ->assertJsonPath('unlisted.0.interns_count', 1);

        $this->assertSame(Courses::NAMES['BSIT'], InternProfile::where('user_id', User::where('email', 'intern@internova.test')->value('id'))->value('course'));
    }

    public function test_an_empty_list_is_allowed(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([])->assertOk()->assertJsonCount(0, 'offered');
        $this->assertSame(0, SchoolCourse::where('school_id', $this->coordinator->school_id)->count());
    }

    // ---- backfill migration -----------------------------------------------

    public function test_the_migration_backfills_courses_from_interns_and_requirement_sets(): void
    {
        $schoolId = $this->coordinator->school_id;
        $other = $this->otherSchoolUser('coordinator');
        $roleId = Role::where('name', 'intern')->value('id');
        foreach ([['a', 'BSIT'], ['b', 'bsit'], ['c', 'Bachelor of Science in Nursing'], ['d', 'Diploma in Culinary Arts']] as [$n, $course]) {
            $u = User::create(['name' => "I {$n}", 'email' => "i.{$n}.bf@internova.test", 'password' => null, 'role_id' => $roleId, 'school_id' => $other->school_id, 'first_name' => 'I', 'last_name' => $n, 'status' => 'active']);
            InternProfile::create(['user_id' => $u->id, 'school_id' => $other->school_id, 'course' => $course, 'required_hours' => 500]);
        }
        \App\Models\CourseRequirementSet::create(['school_id' => $other->school_id, 'course' => 'Bachelor of Science in Pharmacy']);

        // Run the migration's backfill again on an emptied table (no DDL here: it would break the test transaction).
        SchoolCourse::query()->delete();
        $migration = require database_path('migrations/2026_10_20_000100_create_school_courses_table.php');
        $backfill = new \ReflectionMethod($migration, 'backfill');
        $backfill->setAccessible(true);
        $backfill->invoke($migration);

        $this->assertSame([Courses::NAMES['BSIT']], SchoolCourse::where('school_id', $schoolId)->pluck('name')->all());
        $names = SchoolCourse::where('school_id', $other->school_id)->orderBy('sort_order')->pluck('name')->all();
        $this->assertSame(Courses::NAMES['BSIT'], $names[0]); // two interns: most used first
        $this->assertEqualsCanonicalizing([Courses::NAMES['BSIT'], Courses::NAMES['BSN'], 'Diploma in Culinary Arts', Courses::NAMES['BSPHARMA']], $names);
        $this->assertNull(SchoolCourse::where('school_id', $schoolId)->value('required_hours'));
        $this->assertSame(4, InternProfile::where('school_id', $other->school_id)->count()); // interns untouched
    }

    // ---- add intern -------------------------------------------------------

    public function test_add_intern_accepts_an_offered_course_by_code_or_by_name_and_stores_the_full_name(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->postJson('/api/coordinator/interns', $this->internBody())->assertOk();
        $this->postJson('/api/coordinator/interns', $this->internBody(['email' => 'two.sc@gmail.com', 'course' => 'bs information technology']))->assertOk();
        $this->postJson('/api/coordinator/interns', $this->internBody(['email' => 'three.sc@gmail.com', 'course' => Courses::NAMES['BSTM']]))->assertOk();

        foreach (['maria.garcia.sc@gmail.com', 'two.sc@gmail.com'] as $email) {
            $this->assertSame(Courses::NAMES['BSIT'], InternProfile::where('user_id', User::where('email', $email)->value('id'))->value('course'));
        }
        $this->assertSame(Courses::NAMES['BSTM'], InternProfile::where('user_id', User::where('email', 'three.sc@gmail.com')->value('id'))->value('course'));
    }

    public function test_add_intern_refuses_a_course_the_school_does_not_offer(): void
    {
        Sanctum::actingAs($this->coordinator);
        foreach (['BSN', 'Bachelor of Science in Nursing', 'Whatever Program', 'Other'] as $course) {
            $this->postJson('/api/coordinator/interns', $this->internBody(['course' => $course]))
                ->assertStatus(422)
                ->assertJsonPath('success', false)
                ->assertJsonPath('message', "This course isn't offered by your school. Add it in Settings → Courses offered.")
                ->assertJsonPath('errors.course.0', "This course isn't offered by your school. Add it in Settings → Courses offered.");
        }
        $this->postJson('/api/coordinator/interns', $this->internBody(['course' => '']))->assertStatus(422)->assertJsonValidationErrors('course');
        $this->postJson('/api/coordinator/interns', array_diff_key($this->internBody(), ['course' => 1]))->assertStatus(422)->assertJsonValidationErrors('course');
        $this->assertDatabaseMissing('users', ['email' => 'maria.garcia.sc@gmail.com']);
    }

    public function test_add_intern_before_any_course_is_set_up_says_to_set_them_up_first(): void
    {
        $other = $this->otherSchoolUser('coordinator');
        $company = Company::create(['school_id' => $other->school_id, 'company_code' => 'ACME-X', 'company_name' => 'Acme', 'address' => 'Cebu', 'contact_email' => 'a@acme.test', 'contact_number' => '09170000010', 'status' => 'active']);
        Sanctum::actingAs($other);
        $this->offer([])->assertOk(); // the school removed every course

        $this->postJson('/api/coordinator/interns', $this->internBody(['company_id' => $company->id]))
            ->assertStatus(422)
            ->assertJsonPath('message', "Your school hasn't set up its courses yet. Set them in Settings → Courses offered first.");
        $this->assertDatabaseMissing('users', ['email' => 'maria.garcia.sc@gmail.com']);

        // Courses of the first school do not count for this one.
        $this->offer([['name' => 'BSN']])->assertOk();
        $this->postJson('/api/coordinator/interns', $this->internBody(['company_id' => $company->id]))->assertStatus(422)
            ->assertJsonPath('message', SchoolCourseMessage::NOT_OFFERED);
        $this->postJson('/api/coordinator/interns', $this->internBody(['company_id' => $company->id, 'course' => 'BS Nursing']))->assertOk();
    }

    // ---- required hours ---------------------------------------------------

    public function test_required_hours_come_from_the_school_setting_else_the_catalog_default(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([
            ['name' => 'BSIT', 'required_hours' => 486],
            ['name' => 'BSCRIM', 'required_hours' => null],
            ['name' => 'BSN', 'required_hours' => null],
            ['name' => 'Diploma in Culinary Arts', 'required_hours' => null],
            ['name' => 'Short Program', 'required_hours' => 120],
        ])->assertOk();

        $expected = ['BSIT' => 486, 'BSCRIM' => 250, 'BSN' => 500, 'Diploma in Culinary Arts' => 500, 'Short Program' => 120];
        $i = 0;
        foreach ($expected as $course => $hours) {
            $email = 'hours' . $i++ . '.sc@gmail.com';
            $this->postJson('/api/coordinator/interns', $this->internBody(['email' => $email, 'course' => $course]))->assertOk();
            $id = User::where('email', $email)->value('id');
            $this->assertSame($hours, (int) InternProfile::where('user_id', $id)->value('required_hours'), "profile hours for {$course}");
            $this->assertSame($hours, (int) InternshipDeployment::where('intern_id', $id)->value('required_hours'), "deployment hours for {$course}");
        }
    }

    public function test_changing_a_course_hours_updates_existing_interns_but_not_completed_ones(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([['name' => 'BSIT', 'required_hours' => null], ['name' => 'BSBA', 'required_hours' => null]])->assertOk();
        foreach (['it.a', 'it.done', 'ba.a'] as $who) {
            $this->postJson('/api/coordinator/interns', $this->internBody(['email' => "{$who}.sc@gmail.com", 'course' => str_starts_with($who, 'it') ? 'BSIT' : 'BSBA']))->assertOk();
        }
        $id = fn (string $who) => User::where('email', "{$who}.sc@gmail.com")->value('id');
        InternshipDeployment::where('intern_id', $id('it.done'))->update(['status' => 'completed']);

        $res = $this->offer([['name' => 'BSIT', 'required_hours' => 486], ['name' => 'BSBA', 'required_hours' => null]])->assertOk();

        $this->assertGreaterThanOrEqual(1, $res->json('interns_updated'));
        $hours = fn (string $who) => [(int) InternProfile::where('user_id', $id($who))->value('required_hours'), (int) InternshipDeployment::where('intern_id', $id($who))->value('required_hours')];
        $this->assertSame([486, 486], $hours('it.a'));
        $this->assertSame([500, 500], $hours('it.done'), 'a completed internship keeps its hours');
        $this->assertSame([500, 500], $hours('ba.a'), 'other courses are untouched');
        $this->assertStringContainsString('required hours updated', (string) ActivityLog::latest('id')->value('description'));

        // Back to the catalog default (null) follows too; saving again without a change touches nobody.
        $this->offer([['name' => 'BSIT', 'required_hours' => null], ['name' => 'BSBA', 'required_hours' => null]])->assertOk()->assertJsonPath('interns_updated', $res->json('interns_updated'));
        $this->assertSame([500, 500], $hours('it.a'));
        $this->offer([['name' => 'BSIT', 'required_hours' => null], ['name' => 'BSBA', 'required_hours' => null]])->assertOk()->assertJsonPath('interns_updated', 0);
    }

    public function test_hours_change_stays_inside_the_school(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([['name' => 'BSIT', 'required_hours' => null]])->assertOk();
        $this->postJson('/api/coordinator/interns', $this->internBody())->assertOk();
        $mine = User::where('email', 'maria.garcia.sc@gmail.com')->value('id');

        $other = $this->otherSchoolUser('coordinator');
        Sanctum::actingAs($other);
        $this->offer([['name' => 'BSIT', 'required_hours' => null]])->assertOk();
        $this->offer([['name' => 'BSIT', 'required_hours' => 300]])->assertOk()->assertJsonPath('interns_updated', 0);

        $this->assertSame(500, (int) InternProfile::where('user_id', $mine)->value('required_hours'));
        $this->assertSame(500, (int) InternshipDeployment::where('intern_id', $mine)->value('required_hours'));
    }

    // ---- import -----------------------------------------------------------

    public function test_import_preview_and_create_accept_offered_courses_and_refuse_others(): void
    {
        Sanctum::actingAs($this->coordinator);
        $payload = [
            'company_id' => $this->company->id,
            'start_date' => now('Asia/Manila')->toDateString(),
            'rows' => [
                $this->row(['email' => 'imp.a.sc@gmail.com', 'course' => 'BSIT']),
                $this->row(['email' => 'imp.b.sc@gmail.com', 'course' => Courses::NAMES['BSHM']]),
                $this->row(['email' => 'imp.c.sc@gmail.com', 'course' => 'BSN']),
                $this->row(['email' => 'imp.d.sc@gmail.com', 'course' => 'Mystery Program']),
            ],
        ];

        $preview = $this->postJson('/api/coordinator/intern-imports/preview', $payload)->assertOk();
        $this->assertSame(2, $preview->json('valid_count'));
        $this->assertSame(['2', '3'], array_map('strval', array_keys($preview->json('errors'))));
        $this->assertSame(SchoolCourseMessage::NOT_OFFERED, $preview->json('errors.2.course'));

        $this->postJson('/api/coordinator/intern-imports', $payload)->assertStatus(422)->assertJsonPath('errors.3.course', SchoolCourseMessage::NOT_OFFERED);
        $this->assertDatabaseMissing('users', ['email' => 'imp.a.sc@gmail.com']);

        $payload['rows'] = array_slice($payload['rows'], 0, 2);
        $this->postJson('/api/coordinator/intern-imports', $payload)->assertOk()->assertJsonPath('created', 2);
        $this->assertSame(Courses::NAMES['BSIT'], InternProfile::where('user_id', User::where('email', 'imp.a.sc@gmail.com')->value('id'))->value('course'));
    }

    public function test_import_uses_the_school_hours_and_says_to_set_up_courses_first_when_none(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->offer([['name' => 'BSIT', 'required_hours' => 420], ['name' => 'BSCRIM']])->assertOk();
        $this->postJson('/api/coordinator/intern-imports', [
            'company_id' => $this->company->id,
            'start_date' => now('Asia/Manila')->toDateString(),
            'rows' => [$this->row(['email' => 'h1.sc@gmail.com', 'course' => 'BSIT']), $this->row(['email' => 'h2.sc@gmail.com', 'course' => 'BS Criminology'])],
        ])->assertOk();
        $this->assertSame(420, (int) InternProfile::where('user_id', User::where('email', 'h1.sc@gmail.com')->value('id'))->value('required_hours'));
        $this->assertSame(250, (int) InternProfile::where('user_id', User::where('email', 'h2.sc@gmail.com')->value('id'))->value('required_hours'));

        $this->offer([])->assertOk();
        $preview = $this->postJson('/api/coordinator/intern-imports/preview', [
            'rows' => [$this->row(['email' => 'h3.sc@gmail.com'])],
        ])->assertOk();
        $this->assertSame(SchoolCourseMessage::NONE_YET, $preview->json('errors.0.course'));
        $this->assertSame(0, $preview->json('valid_count'));
    }

    // ---- requirements per course -------------------------------------------

    public function test_requirements_list_offered_courses_then_leftovers_marked_not_offered(): void
    {
        $school = School::first();
        Sanctum::actingAs($this->coordinator);

        $names = fn () => collect($this->getJson('/api/coordinator/course-requirements')->assertOk()->json('courses'));
        $this->assertSame(array_map(fn ($c) => Courses::NAMES[$c], Courses::DEFAULT_OFFERED), $names()->pluck('name')->all());
        $this->assertSame([true], $names()->pluck('offered')->unique()->values()->all());

        // BSIT stays offered (it has the demo intern); a configured set and an intern keep a dropped course listed.
        CourseRequirementService::forSchool($school)->save(Courses::NAMES['BSHM'], ['Resume']);
        $this->offer([['name' => 'BSIT'], ['name' => 'BSN']])->assertOk();

        $list = $names();
        $this->assertSame([Courses::NAMES['BSIT'], Courses::NAMES['BSN'], Courses::NAMES['BSHM']], $list->pluck('name')->all());
        $this->assertSame([true, true, false], $list->pluck('offered')->all());
        $this->assertTrue($list->firstWhere('name', Courses::NAMES['BSHM'])['configured']);

        // Drop BSIT too: the demo intern still has it, so it is listed as not offered with its count.
        $this->offer([['name' => 'BSN']])->assertOk();
        $bsit = $names()->firstWhere('name', Courses::NAMES['BSIT']);
        $this->assertFalse($bsit['offered']);
        $this->assertSame(1, $bsit['interns_count']);

        // A leftover can still be tidied up (reset), a never-offered catalog course cannot be configured.
        $this->putJson('/api/coordinator/course-requirements', ['course' => Courses::NAMES['BSHM'], 'requirements' => ['Resume', 'Waiver']])->assertOk();
        $this->putJson('/api/coordinator/course-requirements', ['course' => Courses::NAMES['BSME'], 'requirements' => ['Resume']])->assertStatus(422);
    }
}

/** The two messages the UI shows (kept here so a wording change is a deliberate test edit). */
final class SchoolCourseMessage
{
    public const NOT_OFFERED = "This course isn't offered by your school. Add it in Settings → Courses offered.";
    public const NONE_YET = "Your school hasn't set up its courses yet. Set them in Settings → Courses offered first.";
}
