<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\InternshipDeployment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Intern-side QA fixes: one row per clock-in punch, no future narrative dates, http(s)-only portfolio links. */
class InternQaFixesTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;

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
        $this->intern = User::findOrFail($this->dep->intern_id);
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC')); // 9:00 AM Manila
        Sanctum::actingAs($this->intern);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function clockIn()
    {
        $company = $this->dep->company;

        return $this->post('/api/intern/attendance/clock-in', [
            'selfie' => UploadedFile::fake()->image('s.png'),
            'latitude' => (float) $company->latitude, 'longitude' => (float) $company->longitude,
            'accuracy' => 10, 'fix_age' => 1,
        ], ['Accept' => 'application/json']);
    }

    public function test_a_repeated_clock_in_never_creates_a_second_row(): void
    {
        $this->clockIn()->assertOk();
        $this->clockIn()->assertStatus(422);
        $this->clockIn()->assertStatus(422);

        $this->assertSame(1, Attendance::where('deployment_id', $this->dep->id)->count());
    }

    public function test_a_future_narrative_date_is_refused_but_today_and_the_past_are_fine(): void
    {
        $this->postJson('/api/intern/activities', ['title' => 'Later', 'activity_date' => '2026-10-15'])
            ->assertStatus(422)->assertJsonValidationErrors('activity_date');
        $this->postJson('/api/intern/activities', ['title' => 'Today', 'activity_date' => '2026-10-14'])->assertOk();
        $this->postJson('/api/intern/activities', ['title' => 'Past', 'activity_date' => '2026-10-01'])->assertOk();
        $this->postJson('/api/intern/activities', ['title' => 'No date'])->assertOk();
    }

    public function test_portfolio_links_must_be_http_or_https(): void
    {
        $this->postJson('/api/intern/portfolio/items', ['title' => 'A', 'project_url' => 'ftp://example.com/x'])
            ->assertStatus(422)->assertJsonValidationErrors('project_url');
        $this->postJson('/api/intern/portfolio/items', ['title' => 'B', 'project_url' => 'javascript:alert(1)'])
            ->assertStatus(422)->assertJsonValidationErrors('project_url');
        $this->postJson('/api/intern/portfolio/items', ['title' => 'C', 'project_url' => 'https://example.com/x'])->assertOk();
    }
}
