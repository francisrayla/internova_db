<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\CertificateTemplate;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\User;
use App\Services\CertificateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * OJT certificate of completion: the supervisor uploads a PowerPoint template once and
 * gets a filled-in copy per intern.
 */
class CertificateTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $sup;
    private string $sample;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC'));
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['start_date' => '2026-07-13', 'end_date' => '2026-10-02', 'required_hours' => 500]);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->sample = resource_path('certificate/sample-certificate-template.pptx');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** A tiny but real .pptx whose single slide holds the given paragraphs, each a list of run texts. */
    private function pptx(array $paragraphs): string
    {
        $path = tempnam(sys_get_temp_dir(), 'tpl') . '.pptx';
        $zip = new \ZipArchive();
        $zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
        $zip->addFromString('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
        $paras = '';
        foreach ($paragraphs as $runs) {
            $paras .= '<a:p>' . implode('', array_map(fn ($t) => '<a:r><a:rPr b="1"/><a:t>' . htmlspecialchars($t, ENT_XML1) . '</a:t></a:r>', $runs)) . '</a:p>';
        }
        $zip->addFromString('ppt/slides/slide1.xml', '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>' . $paras . '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
        $zip->close();

        return $path;
    }

    private function upload(string $path, string $name = 'certificate.pptx')
    {
        Sanctum::actingAs($this->sup);

        return $this->post('/api/supervisor/certificates/template', ['template' => new UploadedFile($path, $name, null, null, true)], ['Accept' => 'application/json']);
    }

    /** All text on slide 1 of a downloaded certificate. */
    private function slideText($response): string
    {
        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($response->baseResponse->getFile()->getPathname()) === true, 'download is not a valid zip');
        $xml = $zip->getFromName('ppt/slides/slide1.xml');
        $this->assertNotFalse($xml);
        $dom = new \DOMDocument();
        $this->assertTrue($dom->loadXML($xml), 'slide XML must stay valid');
        $zip->close();

        return preg_replace('/\s+/u', ' ', $dom->documentElement->textContent);
    }

    public function test_the_sample_template_is_a_valid_presentation_with_every_marker(): void
    {
        $this->assertTrue(CertificateService::isPresentation($this->sample));
        $this->assertEqualsCanonicalizing(array_keys(CertificateService::PLACEHOLDERS), CertificateService::markersIn($this->sample));
    }

    public function test_supervisor_uploads_a_template_and_every_supervisor_of_the_company_sees_it(): void
    {
        $this->upload($this->sample, 'OJT certificate.pptx')->assertOk()->assertJsonPath('success', true);

        $other = User::create([
            'name' => 'Onyok Padilla', 'email' => 'second@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Onyok', 'last_name' => 'Padilla', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $other->id, 'school_id' => $this->dep->school_id, 'company_id' => $this->dep->company_id]);

        Sanctum::actingAs($other);
        $res = $this->getJson('/api/supervisor/certificates')->assertOk();
        $res->assertJsonPath('template.name', 'OJT certificate.pptx');
        $this->assertContains('NAME', $res->json('template.markers'));
        $this->assertContains('NAME', collect($res->json('placeholders'))->pluck('key')->all());
        $this->assertContains($this->dep->id, collect($res->json('interns'))->pluck('deployment_id')->all());
    }

    public function test_templates_that_would_never_work_are_refused(): void
    {
        $txt = tempnam(sys_get_temp_dir(), 'x') . '.txt';
        file_put_contents($txt, 'hello');
        $this->upload($txt, 'notes.txt')->assertStatus(422);

        $noName = $this->pptx([['Certificate for someone']]);
        $this->upload($noName)->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, '{{NAME}}'));

        $this->assertSame(0, CertificateTemplate::count());
    }

    public function test_a_name_with_markup_or_symbols_is_refused(): void
    {
        $this->upload($this->pptx([['{{NAME}}']]))->assertOk();
        $this->post('/api/supervisor/certificates/generate', ['deployment_id' => $this->dep->id, 'name' => 'Maria & "Ana" <Cruz>'], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('name');
    }

    public function test_generating_fills_every_marker_even_when_powerpoint_split_it_into_runs(): void
    {
        $this->upload($this->pptx([['{{', 'NAME', '}}'], ['{{HOURS}} hours at ', '{{COMPANY}}'], ['Given {{ DATE }} by {{SUPERVISOR}}']]))->assertOk();
        Attendance::create(['deployment_id' => $this->dep->id, 'attendance_date' => '2026-09-01', 'clock_in' => '2026-09-01 00:00:00', 'clock_out' => '2026-09-01 09:00:00', 'status' => 'approved']);

        Sanctum::actingAs($this->sup);
        // Characters XML must escape still reach the slide: '&' in the company name (allowed there), an apostrophe in the name.
        Company::whereKey($this->dep->company_id)->update(['company_name' => 'Cruz & Sons (Main)']);
        $res = $this->post('/api/supervisor/certificates/generate', ['deployment_id' => $this->dep->id, 'name' => "Maria O'Neil-Cruz"], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame('application/vnd.openxmlformats-officedocument.presentationml.presentation', $res->headers->get('Content-Type'));
        $text = $this->slideText($res);
        $this->assertStringContainsString("Maria O'Neil-Cruz", $text);
        $this->assertStringContainsString('9 hours at ' . Company::find($this->dep->company_id)->company_name, $text);
        $this->assertStringContainsString('Given October 14, 2026 by ' . trim("{$this->sup->first_name} {$this->sup->last_name}"), $text);
        $this->assertStringNotContainsString('{{', $text);
    }

    public function test_the_sample_template_produces_a_complete_certificate(): void
    {
        $this->upload($this->sample)->assertOk();

        Sanctum::actingAs($this->sup);
        $res = $this->post('/api/supervisor/certificates/generate', [
            'deployment_id' => $this->dep->id, 'name' => 'Rina Santos', 'uppercase' => true, 'hours' => 486,
            'start_date' => '2026-07-13', 'end_date' => '2026-10-02', 'date_issued' => '2026-10-05', 'signatory' => 'Jose Dela Cruz',
        ], ['Accept' => 'application/json'])->assertOk();

        $text = $this->slideText($res);
        foreach (['RINA SANTOS', '486 hours', 'July 13, 2026', 'October 2, 2026', 'Given this October 5, 2026', 'Jose Dela Cruz'] as $expected) {
            $this->assertStringContainsString($expected, $text);
        }
        $this->assertStringNotContainsString('{{', $text);
        $this->assertStringContainsString('Certificate of Completion - Rina Santos.pptx', $res->headers->get('Content-Disposition'));
    }

    public function test_cannot_generate_without_a_template_or_for_another_companys_intern(): void
    {
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/supervisor/certificates/generate', ['deployment_id' => $this->dep->id, 'name' => 'Rina'])->assertStatus(422);

        $this->upload($this->sample)->assertOk();
        $elsewhere = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-77', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $stranger = User::create([
            'name' => 'Ana Reyes', 'email' => 'stranger@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $stranger->id, 'school_id' => $this->dep->school_id, 'company_id' => $elsewhere->id]);

        Sanctum::actingAs($stranger);
        $this->postJson('/api/supervisor/certificates/generate', ['deployment_id' => $this->dep->id, 'name' => 'Rina'])->assertNotFound();
        $this->assertSame([], $this->getJson('/api/supervisor/certificates')->assertOk()->json('interns'));
        $this->assertNull($this->getJson('/api/supervisor/certificates')->json('template'));
    }

    public function test_an_intern_cannot_use_the_certificate_tools(): void
    {
        Sanctum::actingAs(User::findOrFail($this->dep->intern_id));
        $this->getJson('/api/supervisor/certificates')->assertForbidden();
        $this->postJson('/api/supervisor/certificates/generate', ['deployment_id' => $this->dep->id, 'name' => 'x'])->assertForbidden();
    }

    public function test_replacing_and_removing_the_template(): void
    {
        $this->upload($this->sample, 'first.pptx')->assertOk();
        $first = CertificateTemplate::firstOrFail()->file_path;
        $this->upload($this->pptx([['{{NAME}}']]), 'second.pptx')->assertOk();

        $this->assertSame(1, CertificateTemplate::count());
        $this->assertSame('second.pptx', CertificateTemplate::first()->original_name);
        Storage::disk('public')->assertMissing($first);

        Sanctum::actingAs($this->sup);
        $this->deleteJson('/api/supervisor/certificates/template')->assertOk();
        $this->assertSame(0, CertificateTemplate::count());
        $this->deleteJson('/api/supervisor/certificates/template')->assertNotFound();
        $this->get('/api/supervisor/certificates/sample')->assertOk();
    }
}
