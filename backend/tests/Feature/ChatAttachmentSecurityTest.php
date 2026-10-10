<?php

namespace Tests\Feature;

use App\Models\GroupConversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;
use ZipArchive;

/**
 * Chat attachments are served from our own domain, so html / svg / php (and files that merely
 * pretend to be something else) must never be stored. Allowed types are stored under a generated name.
 */
class ChatAttachmentSecurityTest extends TestCase
{
    use RefreshDatabase;

    private User $coord;
    private User $sup;
    private User $intern;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->coord = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->intern = User::where('email', 'intern@internova.test')->firstOrFail();
    }

    private function send(UploadedFile $file, ?string $message = null)
    {
        Sanctum::actingAs($this->coord);

        $r = $this->post('/api/messages', array_filter([
            'receiver_id' => $this->sup->id, 'attachment' => $file, 'message' => $message,
        ]), ['Accept' => 'application/json']);
        return $r;
    }

    /** A real uploaded file (the framework's fake one reports a type from its extension, which would hide spoofing). */
    private function real(string $name, string $content): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'up');
        file_put_contents($path, $content);

        return new UploadedFile($path, $name, null, null, true);
    }

    private function zipBytes(string $entry = 'a.txt'): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'zip');
        $zip = new ZipArchive();
        $zip->open($tmp, ZipArchive::OVERWRITE);
        $zip->addFromString($entry, 'hello');
        $zip->close();
        $bytes = file_get_contents($tmp);
        unlink($tmp);

        return $bytes;
    }

    private function pngBytes(): string
    {
        return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    }

    // ---- refused ---------------------------------------------------------

    public static function dangerousUploads(): array
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';
        $html = '<html><body><script>alert(1)</script></body></html>';
        $php = '<?php system($_GET["c"]); ?>';

        return [
            'html file' => ['page.html', $html],
            'htm file' => ['page.htm', $html],
            'svg file' => ['logo.svg', $svg],
            'svg renamed to png' => ['logo.png', $svg],
            'html renamed to txt' => ['notes.txt', $html],
            'html renamed to pdf' => ['report.pdf', $html],
            'php file' => ['shell.php', $php],
            'phtml file' => ['shell.phtml', $php],
            'php renamed to jpg' => ['photo.jpg', $php],
            'double extension php.png' => ['photo.php.png', null],
            'double extension html.txt' => ['page.html.txt', 'hello'],
            'xml file' => ['data.xml', '<?xml version="1.0"?><a/>'],
            'javascript file' => ['x.js', 'alert(1)'],
            'executable' => ['setup.exe', "MZ\x90\x00\x03"],
            'no extension' => ['README', 'hello'],
        ];
    }

    #[DataProvider("dangerousUploads")]
    public function test_dangerous_files_are_rejected_everywhere(string $name, ?string $content): void
    {
        $content ??= $this->pngBytes();
        $file = $this->real($name, $content);

        $this->send($file)->assertStatus(422)->assertJsonValidationErrors('attachment');
        $this->assertSame(0, Message::count());
        $this->assertSame([], Storage::disk('public')->allFiles());

        // Same rules on a group chat.
        $group = GroupConversation::create(['name' => 'g', 'created_by' => $this->coord->id, 'school_id' => $this->coord->school_id]);
        foreach ([$this->coord, $this->sup] as $u) {
            $group->members()->create(['user_id' => $u->id]);
        }
        Sanctum::actingAs($this->coord);
        $this->post("/api/messages/groups/{$group->id}/messages", ['attachment' => $this->real($name, $content)], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('attachment');
        $this->assertSame(0, $group->messages()->count());
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_an_oversized_file_is_rejected(): void
    {
        $this->send(UploadedFile::fake()->create('big.pdf', 10241, 'application/pdf'))->assertStatus(422)->assertJsonValidationErrors('attachment');
    }

    // ---- allowed ---------------------------------------------------------

    public static function safeUploads(): array
    {
        return [
            'png' => ['photo.png', 'png', 'image/png'],
            'pdf' => ['report.pdf', 'pdf', 'application/pdf'],
            'txt' => ['notes.txt', 'txt', 'text/plain'],
            'csv' => ['sheet.csv', 'csv', null],
            'zip' => ['bundle.zip', 'zip', 'application/zip'],
            'docx' => ['letter.docx', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ];
    }

    #[DataProvider("safeUploads")]
    public function test_allowed_types_are_stored_under_a_generated_name(string $name, string $ext, ?string $expectedType): void
    {
        $content = match ($ext) {
            'png' => $this->pngBytes(),
            'pdf' => "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
            'txt' => "just some notes\nsecond line\n",
            'csv' => "name,hours\nRina,12\n",
            default => $this->zipBytes($ext === 'docx' ? 'word/document.xml' : 'a.txt'),
        };

        $res = $this->send($this->real($name, $content), 'here you go')->assertOk();

        $data = $res->json('message_data');
        $this->assertSame($name, $data['attachment_name']);
        if ($expectedType) {
            $this->assertSame($expectedType, $data['attachment_type']);
        }
        $row = Message::firstOrFail();
        $this->assertMatchesRegularExpression('#^message-attachments/'.$this->coord->id.'/[0-9a-f-]{36}\.'.$ext.'$#', $row->attachment_path);
        $this->assertStringNotContainsString('photo', $row->attachment_path);
        Storage::disk('public')->assertExists($row->attachment_path);
    }

    public function test_the_recorded_type_comes_from_the_allow_list_not_from_the_browser(): void
    {
        // The browser claims text/html for a real PNG: we record image/png.
        $path = tempnam(sys_get_temp_dir(), 'png');
        file_put_contents($path, $this->pngBytes());
        $file = new UploadedFile($path, 'photo.png', 'text/html', null, true);
        $this->send($file)->assertOk()->assertJsonPath('message_data.attachment_type', 'image/png');
    }

    public function test_the_display_name_is_cleaned_but_the_file_is_kept(): void
    {
        $name = '..\\..\\<img src=x onerror=alert(1)>.pdf';
        $res = $this->send($this->real($name, "%PDF-1.4\n%%EOF\n"))->assertOk();

        $shown = $res->json('message_data.attachment_name');
        $this->assertStringNotContainsString('<', $shown);
        $this->assertStringNotContainsString('>', $shown);
        $this->assertStringNotContainsString('..', $shown);
        $this->assertStringNotContainsString('/', $shown);
        $this->assertStringEndsWith('.pdf', $shown);
        $this->assertStringNotContainsString('..', Message::firstOrFail()->attachment_path);
    }

    public function test_group_chat_accepts_a_safe_file(): void
    {
        $group = GroupConversation::create(['name' => 'g', 'created_by' => $this->coord->id, 'school_id' => $this->coord->school_id]);
        foreach ([$this->coord, $this->sup, $this->intern] as $u) {
            $group->members()->create(['user_id' => $u->id]);
        }
        Sanctum::actingAs($this->coord);
        $this->post("/api/messages/groups/{$group->id}/messages", ['attachment' => $this->real('a.png', $this->pngBytes())], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('message_data.attachment_type', 'image/png');
        $this->assertMatchesRegularExpression('#^message-attachments/\d+/[0-9a-f-]{36}\.png$#', $group->messages()->firstOrFail()->attachment_path);
    }
}
