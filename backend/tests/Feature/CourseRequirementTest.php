<?php

namespace Tests\Feature;

use App\Models\CoordinatorProfile;
use App\Models\CourseRequirement;
use App\Models\CourseRequirementSet;
use App\Models\Document;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use App\Services\CourseRequirementService;
use App\Services\NarrativeProgressService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CourseRequirementTest extends TestCase
{
    use RefreshDatabase;

    private const COURSE = 'Diploma in Culinary Arts';

    private const DEFAULTS = ['Endorsement Letter', 'Brgy. Clearance', 'Waiver', 'Resume', 'Certificate of Completion'];

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\InternovaSeeder::class);
        // A program that is not one of the listed ones, so the tests cover a school's own course name.
        InternProfile::where('user_id', User::where('email', 'intern@internova.test')->value('id'))->update(['course' => self::COURSE]);
        // The school offers it (Settings -> Courses offered); the demo seeder already offers BSIT and a few more.
        \App\Models\SchoolCourse::create(['school_id' => School::first()->id, 'name' => self::COURSE, 'sort_order' => 9]);
    }

    private function coordinator(): User
    {
        return User::where('email', 'coordinator@internova.test')->first();
    }

    private function intern(): User
    {
        return User::where('email', 'intern@internova.test')->first();
    }

    private function deployment(): InternshipDeployment
    {
        return InternshipDeployment::where('intern_id', $this->intern()->id)->first();
    }

    private function otherSchoolCoordinator(): User
    {
        $school = School::create(['school_code' => 'SCHOOL-002', 'school_name' => 'Other College', 'address' => 'Manila', 'contact_email' => 'o@o.test', 'contact_number' => '09170000002', 'status' => 'active']);
        $user = User::create([
            'name' => 'Other Coordinator', 'email' => 'other@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'coordinator')->first()->id, 'school_id' => $school->id,
            'first_name' => 'Other', 'last_name' => 'Coordinator', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        CoordinatorProfile::create(['user_id' => $user->id, 'school_id' => $school->id, 'is_primary_coordinator' => true]);

        return $user;
    }

    private function upload(string $type, string $status = 'approved'): Document
    {
        $d = $this->deployment();

        return Document::create(['deployment_id' => $d->id, 'uploaded_by' => $d->intern_id, 'document_type' => $type, 'file_name' => 'x.pdf', 'file_path' => 'documents/1/x.pdf', 'status' => $status]);
    }

    private function progress(): array
    {
        $d = $this->deployment();

        return NarrativeProgressService::forDeployments(School::find($d->school_id), collect([$d]))[$d->id];
    }

    private function setReqs(array $requirements, string $course = self::COURSE)
    {
        return $this->putJson('/api/coordinator/course-requirements', ['course' => $course, 'requirements' => $requirements]);
    }

    private function sectionTypes(array $report): array
    {
        return collect($report['template']['sections'])->where('source', 'document')->pluck('document_type')->values()->all();
    }

    // ---- 2. defaults = today's behaviour ---------------------------------

    public function test_no_rows_means_the_default_set_and_nothing_changes(): void
    {
        $this->assertSame(self::DEFAULTS, CourseRequirementService::forSchool(School::first())->defaultTypes());

        Sanctum::actingAs($this->coordinator());
        $res = $this->getJson('/api/coordinator/course-requirements')->assertOk();
        $this->assertSame(self::DEFAULTS, $res->json('default'));
        $course = collect($res->json('courses'))->firstWhere('name', self::COURSE);
        $this->assertFalse($course['configured']);
        $this->assertSame(self::DEFAULTS, $course['requirements']);
        $this->assertSame(1, $course['interns_count']);
        // The built-in choices come with it, plus the listed programs.
        $this->assertContains('Medical Certificate', collect($res->json('choices'))->pluck('name')->all());
        $this->assertContains(\App\Support\Courses::NAMES['BSIT'], collect($res->json('courses'))->pluck('name')->all());

        // Report + progress: all five document sections, all missing, exactly like before.
        $this->assertSame(0, CourseRequirement::count());
        $p = $this->progress();
        $this->assertSame(5, $p['missing_documents']);

        Sanctum::actingAs($this->intern());
        $report = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk()->json();
        $this->assertSame(self::DEFAULTS, $this->sectionTypes($report));
        $keys = collect($report['template']['sections'])->pluck('key')->all();
        $this->assertSame(['acknowledgement', 'endorsement_letter', 'brgy_clearance', 'waiver', 'resume', 'apprentice_ledger'], array_slice($keys, 0, 6));
    }

    public function test_intern_without_a_course_falls_back_to_the_default(): void
    {
        $this->intern();
        InternProfile::where('user_id', $this->intern()->id)->update(['course' => null]);
        CourseRequirementService::forSchool(School::first())->save(self::COURSE, ['Insurance']);

        Sanctum::actingAs($this->intern());
        $res = $this->getJson('/api/intern/document-types')->assertOk();
        $this->assertNull($res->json('course'));
        $this->assertTrue($res->json('is_default'));
        $this->assertSame(self::DEFAULTS, collect($res->json('requirements'))->pluck('document_type')->all());
        $this->assertSame(5, $this->progress()['missing_documents']);
    }

    public function test_course_names_match_ignoring_case_and_extra_spaces(): void
    {
        InternProfile::where('user_id', $this->intern()->id)->update(['course' => '  diploma IN   culinary arts ']);
        CourseRequirementService::forSchool(School::first())->save(self::COURSE, ['Insurance']);

        $this->assertSame(1, $this->progress()['missing_documents']);
    }

    // ---- custom set -------------------------------------------------------

    public function test_a_custom_set_counts_custom_missing_and_ignores_unticked_types(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume', "Parent's Consent", 'Medical Certificate'])
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertSame(['Resume', "Parent's Consent", 'Medical Certificate'], CourseRequirement::orderBy('sort_order')->pluck('document_type')->all());
        $this->assertSame(1, CourseRequirementSet::count());

        // Waiver etc. are no longer required: 3 required, none done, 3 missing documents.
        $p = $this->progress();
        $this->assertSame(3, $p['missing_documents']);
        $baseDone = $p['done'];

        // Uploading the unticked Waiver does not change the count; the custom one does.
        $this->upload('Waiver', 'pending');
        $this->assertSame(3, $this->progress()['missing_documents']);
        $this->upload("parent's consent");
        $this->assertSame(2, $this->progress()['missing_documents']);
        $this->upload('Resume');
        $p = $this->progress();
        $this->assertSame(1, $p['missing_documents']);
        $this->assertSame($baseDone + 2, $p['done']);
    }

    public function test_report_sections_follow_the_course_and_keep_uploaded_unrequired_types(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume', "Parent's Consent"])->assertOk();
        $this->upload('Waiver', 'pending'); // not required, but uploaded: kept in the report
        $this->upload("PARENT'S CONSENT");

        Sanctum::actingAs($this->intern());
        $report = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk()->json();
        $sections = collect($report['template']['sections']);

        $this->assertSame(['Waiver', 'Resume', "Parent's Consent"], $this->sectionTypes($report));
        $this->assertFalse($sections->firstWhere('key', 'waiver')['required']);
        $this->assertTrue($sections->firstWhere('key', 'resume')['required']);
        $custom = $sections->firstWhere('document_type', "Parent's Consent");
        $this->assertTrue($custom['required']);
        $this->assertSame('PARENT\'S CONSENT', $custom['title']);
        $this->assertSame('PARENT\'S CONSENT', mb_strtoupper($report['documents'][$custom['key']]['document_type']));
        $this->assertNotNull($report['documents']['waiver']);
        $this->assertNull($report['documents']['resume']);

        // The custom page sits before the ledger, the evaluation form is still last.
        $keys = $sections->pluck('key')->all();
        $this->assertLessThan(array_search('apprentice_ledger', $keys, true), array_search($custom['key'], $keys, true));
        $this->assertSame('performance_evaluation', end($keys));

        // Nothing uploaded and not required: no section at all.
        $this->assertNull($sections->firstWhere('key', 'brgy_clearance'));
        $this->assertArrayNotHasKey('brgy_clearance', $report['documents']);
    }

    public function test_word_export_follows_the_courses_sections(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume', "Parent's Consent"])->assertOk();

        Sanctum::actingAs($this->intern());
        $res = $this->get('/api/intern/portfolio/narrative-report/docx')->assertOk();
        $zip = new \ZipArchive();
        $path = tempnam(sys_get_temp_dir(), 'docx');
        file_put_contents($path, $res->streamedContent());
        $this->assertTrue($zip->open($path) === true);
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();
        @unlink($path);

        $this->assertStringContainsString("PARENT'S CONSENT", $xml);
        $this->assertStringNotContainsString('BRGY. CLEARANCE', $xml);
    }

    public function test_a_course_can_require_nothing(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs([])->assertOk();

        $this->assertSame(1, CourseRequirementSet::count());
        $this->assertSame(0, CourseRequirement::count());
        $this->assertSame(0, $this->progress()['missing_documents']);

        $courses = collect($this->getJson('/api/coordinator/course-requirements')->json('courses'));
        $this->assertSame([], $courses->firstWhere('name', self::COURSE)['requirements']);
        $this->assertTrue($courses->firstWhere('name', self::COURSE)['configured']);
    }

    public function test_reset_returns_to_the_default_and_never_touches_documents(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->upload('Insurance');
        $this->setReqs(['Insurance'])->assertOk();
        $this->assertSame(0, $this->progress()['missing_documents']);

        $this->deleteJson('/api/coordinator/course-requirements', ['course' => self::COURSE])->assertOk();
        $this->assertSame(0, CourseRequirementSet::count());
        $this->assertSame(0, CourseRequirement::count());
        $this->assertSame(5, $this->progress()['missing_documents']);
        $this->assertSame(1, Document::count());
    }

    public function test_removing_a_requirement_keeps_uploaded_documents(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Insurance', 'Resume'])->assertOk();
        $this->upload('Insurance');
        $this->setReqs(['Resume'])->assertOk();

        $this->assertSame(1, Document::where('document_type', 'Insurance')->count());
        $this->assertSame(['Resume'], CourseRequirement::pluck('document_type')->all());
    }

    // ---- intern / coordinator upload lists ---------------------------------

    public function test_intern_endpoint_returns_the_courses_list_with_status(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume', 'Waiver', "Parent's Consent"])->assertOk();
        $this->upload('Resume', 'approved');
        $this->upload('waiver', 'rejected');

        Sanctum::actingAs($this->intern());
        $res = $this->getJson('/api/intern/document-types')->assertOk();
        $rows = collect($res->json('requirements'))->keyBy('document_type');

        $this->assertSame(['Resume', 'Waiver', "Parent's Consent"], $rows->keys()->all());
        $this->assertSame('approved', $rows['Resume']['status']);
        $this->assertSame('rejected', $rows['Waiver']['status']);
        $this->assertSame('not_uploaded', $rows["Parent's Consent"]['status']);
        $this->assertFalse($res->json('is_default'));
        $this->assertSame(self::COURSE, $res->json('course'));
        // The rest of the built-ins stay available for an upload; required ones are not repeated.
        $others = $res->json('others');
        $this->assertContains('Medical Certificate', $others);
        $this->assertNotContains('Resume', $others);
    }

    public function test_pending_beats_rejected_and_approved_beats_pending(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume'])->assertOk();
        $this->upload('Resume', 'rejected');
        $this->upload('Resume', 'pending');

        Sanctum::actingAs($this->intern());
        $this->assertSame('pending', $this->getJson('/api/intern/document-types')->json('requirements.0.status'));
        $this->upload('Resume', 'approved');
        $this->assertSame('approved', $this->getJson('/api/intern/document-types')->json('requirements.0.status'));
    }

    public function test_coordinator_document_types_for_an_intern_and_scoping(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Insurance'])->assertOk();
        $id = $this->deployment()->id;

        $res = $this->getJson("/api/coordinator/document-types?deployment_id={$id}")->assertOk();
        $this->assertSame(['Insurance'], collect($res->json('requirements'))->pluck('document_type')->all());
        $this->assertContains('Resume', $res->json('others'));

        Sanctum::actingAs($this->otherSchoolCoordinator());
        $this->getJson("/api/coordinator/document-types?deployment_id={$id}")->assertNotFound();
    }

    // ---- school scoping -----------------------------------------------------

    public function test_another_school_cannot_read_or_modify_these_rows(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Insurance', "Parent's Consent"])->assertOk();

        $other = $this->otherSchoolCoordinator();
        Sanctum::actingAs($other);

        $res = $this->getJson('/api/coordinator/course-requirements')->assertOk();
        $this->assertNotContains(self::COURSE, collect($res->json('courses'))->pluck('name')->all());
        $this->assertNotContains("Parent's Consent", collect($res->json('choices'))->pluck('name')->all());
        $this->assertSame(collect(CourseRequirementService::BUILTIN_TYPES)->all(), collect($res->json('choices'))->pluck('name')->all());

        // A course the other school has no interns in cannot be configured, nor reset, nor can the first school's custom name be renamed.
        $this->setReqs(['Resume'])->assertStatus(422);
        $this->deleteJson('/api/coordinator/course-requirements', ['course' => self::COURSE])->assertStatus(422);
        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => "Parent's Consent", 'to' => 'Hacked'])->assertStatus(422);
        // A catalog course their school does not offer yet cannot be configured; once offered, it works and is stored under their school only.
        $this->setReqs(['Resume'], 'BSN')->assertStatus(422);
        \App\Models\SchoolCourse::create(['school_id' => $other->school_id, 'name' => \App\Support\Courses::NAMES['BSN']]);
        $this->setReqs(['Resume'], 'BSN')->assertOk();
        $this->assertSame($other->school_id, CourseRequirement::where('course', \App\Support\Courses::NAMES['BSN'])->value('school_id'));

        $first = CourseRequirement::where('course', self::COURSE)->pluck('document_type')->all();
        $this->assertSame(['Insurance', "Parent's Consent"], $first);
    }

    public function test_only_coordinators_can_use_the_settings_endpoints(): void
    {
        foreach (['intern@internova.test', 'supervisor@internova.test', 'dean@internova.test'] as $email) {
            Sanctum::actingAs(User::where('email', $email)->first());
            $this->getJson('/api/coordinator/course-requirements')->assertForbidden();
            $this->setReqs(['Resume'])->assertForbidden();
        }
        $this->assertSame(0, CourseRequirementSet::count());
    }

    // ---- validation ------------------------------------------------------------

    public function test_validation_duplicates_length_blank_and_trimming(): void
    {
        Sanctum::actingAs($this->coordinator());

        $this->setReqs(['Resume', ' resume '])->assertStatus(422);
        $this->setReqs(["Parent's Consent", "PARENT'S   CONSENT"])->assertStatus(422);
        $this->setReqs([str_repeat('a', 101)])->assertStatus(422);
        $this->setReqs(['   '])->assertStatus(422);
        $this->setReqs([''])->assertStatus(422);
        $this->setReqs(['Other'])->assertStatus(422);
        $this->setReqs(array_map(fn ($i) => "Type {$i}", range(1, 31)))->assertStatus(422);
        $this->setReqs(['Resume'], 'NOPE')->assertStatus(422);
        $this->putJson('/api/coordinator/course-requirements', ['course' => self::COURSE])->assertStatus(422);
        $this->assertSame(0, CourseRequirementSet::count());

        // 100 characters is fine; whitespace is trimmed and collapsed; a built-in keeps its own spelling.
        $long = str_repeat('b', 100);
        $this->setReqs(["  Parent's    Consent  ", 'resume', $long])->assertOk();
        $this->assertSame(["Parent's Consent", 'Resume', $long], CourseRequirement::orderBy('sort_order')->pluck('document_type')->all());

        // Another course reusing the custom name in other casing gets the school's spelling back.
        $this->setReqs(["PARENT'S CONSENT"], 'BSIT')->assertOk();
        $this->assertSame("Parent's Consent", CourseRequirement::where('course', \App\Support\Courses::NAMES['BSIT'])->value('document_type'));
    }

    // ---- rename ----------------------------------------------------------------------

    public function test_rename_a_custom_requirement_moves_its_uploads_and_refuses_built_ins_and_clashes(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(["Parents Consent"])->assertOk();
        $this->setReqs(["Parents Consent", 'Insurance'], 'BSIT')->assertOk();
        $doc = $this->upload('parents consent');
        $this->upload('Resume');

        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'Resume', 'to' => 'CV'])->assertStatus(422);
        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'Parents Consent', 'to' => 'insurance'])->assertStatus(422);
        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'Parents Consent', 'to' => 'Other'])->assertStatus(422);
        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'Nope', 'to' => 'Whatever'])->assertStatus(422);
        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'Parents Consent', 'to' => str_repeat('x', 101)])->assertStatus(422);

        $this->postJson('/api/coordinator/course-requirements/rename', ['from' => 'parents consent', 'to' => "Parent's Consent"])->assertOk();

        $this->assertSame(2, CourseRequirement::where('document_type', "Parent's Consent")->count());
        $this->assertSame("Parent's Consent", $doc->fresh()->document_type);
        $this->assertSame('Resume', Document::where('document_type', 'Resume')->value('document_type'));
        // The upload still counts after the rename.
        $this->assertSame(0, $this->progress()['missing_documents']);
    }

    // ---- Dean / coordinator flags ----------------------------------------------------

    public function test_the_missing_documents_flag_uses_the_courses_set(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->setReqs(['Resume'])->assertOk();
        $this->upload('Resume');
        $p = $this->progress();
        $this->assertSame(0, $p['missing_documents']);

        // Tick two more: two missing, and the total grows with them.
        $this->setReqs(['Resume', 'Insurance', 'Medical Certificate'])->assertOk();
        $after = $this->progress();
        $this->assertSame(2, $after['missing_documents']);
        $this->assertSame($p['total'] + 2, $after['total']);
    }
}
