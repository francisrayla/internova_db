<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\CoordinatorProfile;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\InternshipDeployment;
use App\Models\NarrativeTemplate;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use App\Services\NarrativeTemplateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NarrativeReportTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function coordinator(): User
    {
        return User::where('email', 'coordinator@internova.test')->first();
    }

    private function intern(): User
    {
        return User::where('email', 'intern@internova.test')->first();
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

    public function test_default_template_is_returned_when_no_row(): void
    {
        Sanctum::actingAs($this->coordinator());

        $this->getJson('/api/coordinator/narrative-template')
            ->assertOk()
            ->assertJsonPath('template.is_default', true)
            ->assertJsonPath('template.letterhead.school_name', 'ABC Technical College')
            ->assertJsonPath('template.cover.submitted_to_name', 'Maria Lopez')
            ->assertJsonPath('template.logo_url', null);

        $this->assertSame(0, NarrativeTemplate::count());
    }

    public function test_school_year_is_derived_from_start_date(): void
    {
        $this->assertSame('2026-2027', NarrativeTemplateService::deriveSchoolYear(Carbon::parse('2026-06-01')));
        $this->assertSame('2025-2026', NarrativeTemplateService::deriveSchoolYear(Carbon::parse('2026-05-31')));
        $this->assertSame('2026-2027', NarrativeTemplateService::deriveSchoolYear(Carbon::parse('2026-12-15')));
    }

    public function test_coordinator_updates_cover_and_letterhead_and_logo(): void
    {
        Storage::fake('public');
        Sanctum::actingAs($this->coordinator());

        $this->patchJson('/api/coordinator/narrative-template', [
            'letterhead' => ['school_name' => 'PMFTCI', 'website' => 'www.pmftci.edu.ph'],
            'cover' => ['department' => 'School of Criminology', 'school_year' => '2026-2027'],
        ])
            ->assertOk()
            ->assertJsonPath('template.is_default', false)
            ->assertJsonPath('template.letterhead.school_name', 'PMFTCI')
            ->assertJsonPath('template.letterhead.address', 'Quezon City')
            ->assertJsonPath('template.cover.department', 'School of Criminology');

        $res = $this->postJson('/api/coordinator/narrative-template/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
            ->assertOk();
        $path = NarrativeTemplate::first()->logo_path;
        $this->assertStringStartsWith('narrative/', $path);
        Storage::disk('public')->assertExists($path);
        $this->assertNotNull($res->json('template.logo_url'));

        // A second upload replaces the first file.
        $this->postJson('/api/coordinator/narrative-template/logo', ['logo' => UploadedFile::fake()->image('logo2.png')])->assertOk();
        Storage::disk('public')->assertMissing($path);

        $this->postJson('/api/coordinator/narrative-template/logo', ['logo' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')])
            ->assertStatus(422);

        $this->deleteJson('/api/coordinator/narrative-template/logo')->assertOk()->assertJsonPath('template.logo_url', null);
        $this->assertNull(NarrativeTemplate::first()->logo_path);
    }

    public function test_other_school_coordinator_cannot_see_or_edit(): void
    {
        Sanctum::actingAs($this->coordinator());
        $this->patchJson('/api/coordinator/narrative-template', ['cover' => ['department' => 'Secret Dept']])->assertOk();
        $deployment = InternshipDeployment::first();

        Sanctum::actingAs($this->otherSchoolCoordinator());

        $this->getJson('/api/coordinator/narrative-template')
            ->assertOk()
            ->assertJsonPath('template.is_default', true)
            ->assertJsonPath('template.cover.department', null);
        $this->getJson("/api/coordinator/interns/{$deployment->id}/narrative-report")->assertNotFound();

        $this->patchJson('/api/coordinator/narrative-template', ['cover' => ['department' => 'Mine']])->assertOk();
        $this->assertSame(2, NarrativeTemplate::count());
        $this->assertSame('Secret Dept', NarrativeTemplate::where('school_id', $this->coordinator()->school_id)->first()->cover['department']);
    }

    public function test_intern_texts_are_saved(): void
    {
        Sanctum::actingAs($this->intern());

        $this->patchJson('/api/intern/portfolio', ['report_texts' => ['acknowledgement' => 'Thank you all.', 'suggestion' => 'More time.']])
            ->assertOk()
            ->assertJsonPath('portfolio.report_texts.acknowledgement', 'Thank you all.');

        // Saving one key does not wipe the others.
        $this->patchJson('/api/intern/portfolio', ['report_texts' => ['personal_observation' => 'Learned a lot.']])->assertOk();

        $this->getJson('/api/intern/portfolio/narrative-report')
            ->assertOk()
            ->assertJsonPath('texts.acknowledgement', 'Thank you all.')
            ->assertJsonPath('texts.personal_observation', 'Learned a lot.')
            ->assertJsonPath('texts.suggestion', 'More time.');
    }

    public function test_intern_report_contains_all_sections_and_matched_documents(): void
    {
        $intern = $this->intern();
        $deployment = InternshipDeployment::where('intern_id', $intern->id)->first();

        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'resume', 'file_name' => 'old.pdf', 'file_path' => 'documents/1/old.pdf', 'status' => 'approved']);
        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'Resume', 'file_name' => 'new.pdf', 'file_path' => 'documents/1/new.pdf', 'status' => 'pending']);
        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'WAIVER', 'file_name' => 'w.png', 'file_path' => 'documents/1/w.png', 'status' => 'pending']);

        Attendance::create([
            'deployment_id' => $deployment->id, 'attendance_date' => '2026-09-01',
            'clock_in' => '2026-09-01 08:00:00', 'clock_out' => '2026-09-01 17:00:00', 'status' => 'approved',
        ]);
        DailyActivity::create([
            'deployment_id' => $deployment->id, 'activity_date' => '2026-09-01', 'title' => 'Filing',
            'description' => 'Filed records.', 'status' => 'recorded',
        ]);
        DailyActivity::create([
            'deployment_id' => $deployment->id, 'activity_date' => '2026-09-02', 'title' => 'Pending one',
            'description' => 'Not signed off.', 'status' => 'pending',
        ]);

        Sanctum::actingAs($intern);
        $res = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk();

        // 15: the attendance-selfie section (Proof of Attendance) is gone, the DTR table covers attendance.
        $this->assertCount(15, $res->json('template.sections'));
        $this->assertSame('ABC Technologies', $res->json('company.name'));
        $this->assertSame('Maria Lopez', $res->json('coordinator.name'));
        // Approved resume wins over the newer pending one; type match ignores case.
        $this->assertSame('old.pdf', $res->json('documents.resume.file_name'));
        $this->assertFalse($res->json('documents.resume.is_image'));
        $this->assertTrue($res->json('documents.waiver.is_image'));
        $this->assertNull($res->json('documents.endorsement_letter'));
        $this->assertSame(9, $res->json('ledger.total_hours'));
        $this->assertCount(1, $res->json('ledger.rows'));
        // Stored UTC (08:00-17:00) is shown in Manila time.
        $this->assertSame('04:00 PM', $res->json('ledger.rows.0.time_in'));
        $this->assertSame('01:00 AM', $res->json('ledger.rows.0.time_out'));
        // Only the recorded entry reaches the journal.
        $this->assertCount(1, $res->json('journal'));
        $this->assertSame('Filed records.', $res->json('journal.0.schedule'));
        $this->assertNull($res->json('evaluation'));
        $this->assertNotEmpty($res->json('duties.tasks'));
        $this->assertStringContainsString('Maria Lopez', collect($res->json('template.sections'))->firstWhere('key', 'co_responsibility')['body']);

        // Coordinator of the same school gets the same payload.
        Sanctum::actingAs($this->coordinator());
        $this->getJson("/api/coordinator/interns/{$deployment->id}/narrative-report")
            ->assertOk()
            ->assertJsonPath('student.name', $res->json('student.name'));
    }

    private function png(int $w = 40, int $h = 30): string
    {
        $im = imagecreatetruecolor($w, $h);
        imagefill($im, 0, 0, imagecolorallocate($im, 200, 40, 40));
        ob_start();
        imagepng($im);

        return ob_get_clean();
    }

    /** Download the docx response to a temp file, return [path, ZipArchive]. */
    private function openDocx($res): array
    {
        $path = $res->baseResponse->getFile()->getPathname();
        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($path) === true, 'docx is not a valid zip');

        return [$path, $zip];
    }

    public function test_intern_downloads_docx_with_text_images_and_pdf_box(): void
    {
        Storage::fake('public');
        $intern = $this->intern();
        $deployment = InternshipDeployment::where('intern_id', $intern->id)->first();

        Storage::disk('public')->put('documents/1/waiver.png', $this->png());
        Storage::disk('public')->put('attendance/in.png', $this->png());
        Storage::disk('public')->put('documents/1/resume.pdf', '%PDF-1.4 fake');
        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'Waiver', 'file_name' => 'waiver.png', 'file_path' => 'documents/1/waiver.png', 'status' => 'approved']);
        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'Resume', 'file_name' => 'resume.pdf', 'file_path' => 'documents/1/resume.pdf', 'status' => 'approved']);
        // Referenced file that does not exist on disk: skipped, no crash.
        Document::create(['deployment_id' => $deployment->id, 'uploaded_by' => $intern->id, 'document_type' => 'Brgy. Clearance', 'file_name' => 'gone.png', 'file_path' => 'documents/1/gone.png', 'status' => 'approved']);
        Attendance::create([
            'deployment_id' => $deployment->id, 'attendance_date' => '2026-09-01',
            'clock_in' => '2026-09-01 08:00:00', 'clock_out' => '2026-09-01 17:00:00', 'status' => 'approved',
            'clock_in_selfie_path' => 'attendance/in.png',
        ]);
        NarrativeTemplate::create(['school_id' => $deployment->school_id, 'letterhead' => ['school_name' => 'PMFTCI Test College']]);

        Sanctum::actingAs($intern);
        $name = $this->getJson('/api/intern/portfolio/narrative-report')->json('student.name');
        $res = $this->get('/api/intern/portfolio/narrative-report/docx')->assertOk();

        $this->assertSame('application/vnd.openxmlformats-officedocument.wordprocessingml.document', $res->headers->get('Content-Type'));
        $this->assertStringContainsString('Narrative_Report_' . preg_replace('/[^A-Za-z0-9]+/', '_', $name) . '.docx', $res->headers->get('Content-Disposition'));

        [$path, $zip] = $this->openDocx($res);
        $doc = $zip->getFromName('word/document.xml');
        $this->assertStringContainsString($name, $doc);
        foreach (['TABLE OF CONTENTS', 'APPRENTICE LEDGER', 'JOURNAL'] as $title) {
            $this->assertStringContainsString($title, $doc);
        }
        $this->assertStringContainsString('Attached separately: ', $doc);
        $this->assertStringContainsString('resume.pdf', $doc);
        $this->assertStringContainsString('Total hours rendered: 9', $doc);
        $this->assertStringContainsString('PMFTCI Test College', $zip->getFromName('word/header1.xml'));
        $this->assertStringContainsString('w:w="12240" w:h="18720"', $doc);

        // waiver image + CHED seal were embedded; the attendance selfie is no longer part of the report;
        // the missing file was skipped.
        $media = collect(range(0, $zip->numFiles - 1))->map(fn ($i) => $zip->getNameIndex($i))->filter(fn ($n) => str_starts_with($n, 'word/media/'));
        $this->assertGreaterThanOrEqual(2, $media->count());
        $zip->close();
        @unlink($path);
    }

    public function test_docx_uses_the_coordinator_endpoint_and_is_school_scoped(): void
    {
        Storage::fake('public');
        $deployment = InternshipDeployment::first();

        Sanctum::actingAs($this->coordinator());
        $res = $this->get("/api/coordinator/interns/{$deployment->id}/narrative-report/docx")->assertOk();
        $this->assertSame('application/vnd.openxmlformats-officedocument.wordprocessingml.document', $res->headers->get('Content-Type'));
        [$path, $zip] = $this->openDocx($res);
        $this->assertStringContainsString('ABC Technical College', $zip->getFromName('word/header1.xml'));
        $zip->close();
        @unlink($path);

        Sanctum::actingAs($this->otherSchoolCoordinator());
        $this->getJson("/api/coordinator/interns/{$deployment->id}/narrative-report/docx")->assertNotFound();

        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->first());
        $this->getJson('/api/intern/portfolio/narrative-report/docx')->assertForbidden();
    }
}
