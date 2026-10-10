<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Every other upload path (avatars, documents, school logo, support tickets, portfolio, certificate
 * templates) must refuse html / svg / php, including files that only pretend to be an allowed type.
 */
class UploadPathsSecurityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function real(string $name, string $content): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'up');
        file_put_contents($path, $content);

        return new UploadedFile($path, $name, null, null, true);
    }

    private function png(): string
    {
        return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    }

    public static function badFiles(): array
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
        $html = '<html><script>alert(1)</script></html>';
        $php = '<?php system($_GET["c"]);';

        return [
            'html' => ['x.html', $html],
            'svg' => ['x.svg', $svg],
            'php' => ['x.php', $php],
            'phtml' => ['x.phtml', $php],
            'svg as png' => ['x.png', $svg],
            'html as pdf' => ['x.pdf', $html],
            'php as jpg' => ['x.jpg', $php],
        ];
    }

    /** @return array<string, array{0: string, 1: string, 2: array, 3: string, 4: string}> user email, url, extra fields, file field, error key */
    private function targets(): array
    {
        $dep = InternshipDeployment::firstOrFail();

        return [
            'avatar' => ['intern@internova.test', '/api/auth/avatar', [], 'avatar'],
            'intern document' => ['intern@internova.test', '/api/intern/documents', ['document_type' => 'Resume'], 'file'],
            'portfolio image' => ['intern@internova.test', '/api/intern/portfolio/items', ['title' => 'Project'], 'image'],
            'coordinator document' => ['coordinator@internova.test', '/api/coordinator/documents', ['deployment_id' => $dep->id, 'document_type' => 'Resume'], 'file'],
            'school logo' => ['coordinator@internova.test', '/api/coordinator/narrative-template/logo', [], 'logo'],
            'support ticket attachment' => ['coordinator@internova.test', '/api/coordinator/support-tickets', ['subject' => 'Help', 'category' => 'General', 'message' => 'Please'], 'attachment'],
        ];
    }

    #[DataProvider('badFiles')]
    public function test_every_upload_path_refuses_dangerous_files(string $name, string $content): void
    {
        foreach ($this->targets() as $label => [$email, $url, $fields, $field]) {
            Sanctum::actingAs(User::where('email', $email)->firstOrFail());
            $res = $this->post($url, $fields + [$field => $this->real($name, $content)], ['Accept' => 'application/json']);
            $this->assertSame(422, $res->status(), "$label accepted $name");
            $res->assertJsonValidationErrors($field);
        }
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_the_certificate_template_must_be_a_real_pptx(): void
    {
        Sanctum::actingAs(User::where('email', 'supervisor@internova.test')->firstOrFail());
        foreach (['t.html' => '<html></html>', 't.svg' => '<svg/>', 't.php' => '<?php', 't.pptx' => '<html><script>alert(1)</script></html>'] as $name => $content) {
            $this->post('/api/supervisor/certificates/template', ['template' => $this->real($name, $content)], ['Accept' => 'application/json'])->assertStatus(422);
        }
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_a_normal_image_still_works_as_an_avatar(): void
    {
        Sanctum::actingAs(User::where('email', 'intern@internova.test')->firstOrFail());
        $this->post('/api/auth/avatar', ['avatar' => $this->real('me.png', $this->png())], ['Accept' => 'application/json'])->assertOk();
        $files = Storage::disk('public')->allFiles();
        $this->assertCount(1, $files);
        $this->assertMatchesRegularExpression('/\.png$/', $files[0]);
    }
}
