<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A refused upload says what to do in plain words ("Choose a JPG, PNG, PDF, DOC or DOCX file."), never
 * "The file field must be a file of type: jpg, jpeg, png, pdf, doc, docx.". The rules themselves are unchanged.
 */
class FriendlyUploadMessagesTest extends TestCase
{
    use RefreshDatabase;

    private const DOC_TYPES = 'Choose a JPG, PNG, PDF, DOC or DOCX file.';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function expectMessage($response, string $field, string $message): void
    {
        $response->assertStatus(422)->assertJsonPath('message', $message);
        $this->assertSame($message, $response->json('errors')[$field][0]);
        $this->assertStringNotContainsString('field must be', $response->json('message'));
    }

    public function test_intern_document_wrong_type_and_too_big(): void
    {
        Sanctum::actingAs(User::where('email', 'intern@internova.test')->firstOrFail());
        $json = ['Accept' => 'application/json'];

        $this->expectMessage($this->post('/api/intern/documents', ['document_type' => 'Resume', 'file' => UploadedFile::fake()->create('virus.exe', 10)], $json), 'file', self::DOC_TYPES);
        $this->expectMessage($this->post('/api/intern/documents', ['document_type' => 'Resume', 'file' => UploadedFile::fake()->create('big.pdf', 11000, 'application/pdf')], $json), 'file', 'The file must be 10 MB or smaller.');
        $this->expectMessage($this->post('/api/intern/documents', ['document_type' => 'Resume'], $json), 'file', 'Choose a file to upload.');

        // A good file still goes through.
        $this->post('/api/intern/documents', ['document_type' => 'Resume', 'file' => UploadedFile::fake()->create('cv.pdf', 100, 'application/pdf')], $json)->assertOk();
    }

    public function test_coordinator_document_upload_uses_the_same_words(): void
    {
        $dep = InternshipDeployment::firstOrFail();
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());

        $this->expectMessage(
            $this->post('/api/coordinator/documents', ['deployment_id' => $dep->id, 'document_type' => 'Resume', 'file' => UploadedFile::fake()->create('x.zip', 10)], ['Accept' => 'application/json']),
            'file',
            self::DOC_TYPES
        );
    }

    public function test_portfolio_image_and_activity_photo(): void
    {
        Sanctum::actingAs(User::where('email', 'intern@internova.test')->firstOrFail());
        $json = ['Accept' => 'application/json'];

        $this->expectMessage($this->post('/api/intern/portfolio/items', ['title' => 'Site', 'image' => UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')], $json), 'image', 'Choose a JPG, PNG, WEBP or GIF file.');
        $this->expectMessage($this->post('/api/intern/portfolio/items', ['title' => 'Site', 'image' => UploadedFile::fake()->image('big.png')->size(11000)], $json), 'image', 'The image must be 10 MB or smaller.');
        $this->expectMessage($this->post('/api/intern/activities', ['title' => 'Day', 'photo' => UploadedFile::fake()->create('a.docx', 10)], $json), 'photo', 'Choose a JPG, PNG, WEBP or GIF file.');
        $this->expectMessage($this->post('/api/intern/activities', ['title' => 'Day', 'photo' => UploadedFile::fake()->image('big.png')->size(11000)], $json), 'photo', 'The photo must be 10 MB or smaller.');
    }

    public function test_task_and_subtask_proofs(): void
    {
        $sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $dep = InternshipDeployment::visibleToSupervisor($sup)->firstOrFail();
        Task::query()->delete();
        Sanctum::actingAs($sup);
        $taskId = $this->postJson('/api/supervisor/tasks', ['title' => 'Proof me', 'priority' => 'low', 'deployment_ids' => [$dep->id]])->assertOk()->json('id');
        $subtaskId = $this->postJson("/api/supervisor/tasks/{$taskId}/subtasks", ['title' => 'Part'])->assertOk()->json('id');
        $plainTaskId = $this->postJson('/api/supervisor/tasks', ['title' => 'No parts', 'priority' => 'low', 'deployment_ids' => [$dep->id]])->assertOk()->json('id');

        Sanctum::actingAs(User::findOrFail($dep->intern_id));
        $json = ['Accept' => 'application/json'];
        $kinds = 'Choose a JPG, PNG, PDF, Word, Excel or PowerPoint file.';

        foreach (["/api/intern/subtasks/{$subtaskId}/complete", "/api/intern/tasks/{$plainTaskId}/complete"] as $url) {
            $this->expectMessage($this->post($url, ['proofs' => [UploadedFile::fake()->create('run.exe', 10)]], $json), 'proofs.0', $kinds);
            $this->expectMessage($this->post($url, ['proofs' => [UploadedFile::fake()->create('big.pdf', 16000, 'application/pdf')]], $json), 'proofs.0', 'The proof file must be 15 MB or smaller.');
            $this->expectMessage($this->post($url, [], $json), 'proofs', 'Attach at least one proof file.');
        }
    }
}
