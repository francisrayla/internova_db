<?php

namespace Tests\Feature;

use App\Models\DailyActivity;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A rejection says why (and the intern sees it); an entry cannot be dated before the internship started. */
class ActivityReviewAndDatesTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $intern;
    private User $sup;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->dep = InternshipDeployment::visibleToSupervisor($this->sup)->firstOrFail();
        $this->dep->update(['start_date' => '2026-07-31', 'status' => 'active']);
        $this->intern = User::findOrFail($this->dep->intern_id);
        DailyActivity::query()->delete();
        Carbon::setTestNow(Carbon::parse('2026-10-14 02:00:00', 'UTC'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function entry(): DailyActivity
    {
        return DailyActivity::create([
            'deployment_id' => $this->dep->id, 'activity_date' => '2026-10-13', 'title' => 'Filed reports',
            'description' => 'I filed.', 'status' => DailyActivity::PENDING,
        ]);
    }

    public function test_a_rejection_needs_a_reason(): void
    {
        $a = $this->entry();
        Sanctum::actingAs($this->sup);

        foreach ([[], ['review_remarks' => ''], ['review_remarks' => '   ']] as $extra) {
            $res = $this->patchJson("/api/supervisor/activities/{$a->id}", ['status' => 'rejected'] + $extra);
            $res->assertStatus(422)->assertJsonValidationErrors('review_remarks');
            $this->assertStringContainsString('reason', $res->json('errors.review_remarks.0'));
        }
        $this->patchJson("/api/supervisor/activities/{$a->id}", ['status' => 'rejected', 'review_remarks' => str_repeat('x', 501)])
            ->assertStatus(422)->assertJsonValidationErrors('review_remarks');
        $this->assertSame(DailyActivity::PENDING, $a->fresh()->status);
    }

    public function test_the_reason_is_saved_sent_to_the_intern_and_shown_on_the_entry(): void
    {
        $a = $this->entry();
        Sanctum::actingAs($this->sup);
        Notification::query()->delete();

        $this->patchJson("/api/supervisor/activities/{$a->id}", ['status' => 'rejected', 'review_remarks' => 'Add what you actually did.'])->assertOk();

        $a->refresh();
        $this->assertSame(DailyActivity::REJECTED, $a->status);
        $this->assertSame('Add what you actually did.', $a->review_remarks);
        $this->assertStringContainsString('Add what you actually did.', Notification::where('user_id', $this->intern->id)->where('type', 'activity_reviewed')->value('body'));

        // The supervisor's list carries it too ...
        $row = collect($this->getJson('/api/supervisor/activities')->json('activities'))->firstWhere('id', $a->id);
        $this->assertSame('Add what you actually did.', $row['review_remarks']);

        // ... and the intern's own list (the "Supervisor remarks" line on the entry).
        Sanctum::actingAs($this->intern);
        $mine = collect($this->getJson('/api/intern/activities')->json('activities'))->firstWhere('id', $a->id);
        $this->assertSame('rejected', $mine['status']);
        $this->assertSame('Add what you actually did.', $mine['review_remarks']);
    }

    public function test_approving_needs_no_reason(): void
    {
        $a = $this->entry();
        Sanctum::actingAs($this->sup);

        $this->patchJson("/api/supervisor/activities/{$a->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame(DailyActivity::APPROVED, $a->fresh()->status);
    }

    public function test_an_entry_cannot_be_dated_before_the_internship_started(): void
    {
        Sanctum::actingAs($this->intern);

        $res = $this->postJson('/api/intern/activities', ['title' => 'Too early', 'activity_date' => '2026-01-05']);
        $res->assertStatus(422)->assertJsonValidationErrors('activity_date');
        $this->assertStringContainsString('July 31, 2026', $res->json('message'));
        $this->assertSame(0, DailyActivity::count());

        $this->postJson('/api/intern/activities', ['title' => 'Day before', 'activity_date' => '2026-07-30'])->assertStatus(422);
        $this->postJson('/api/intern/activities', ['title' => 'First day', 'activity_date' => '2026-07-31'])->assertOk();
        $this->postJson('/api/intern/activities', ['title' => 'Later', 'activity_date' => '2026-10-13'])->assertOk();
        $this->postJson('/api/intern/activities', ['title' => 'Future', 'activity_date' => '2026-10-20'])->assertStatus(422);
        $this->assertSame(2, DailyActivity::count());
    }

    public function test_the_activities_list_tells_the_date_picker_its_minimum(): void
    {
        Sanctum::actingAs($this->intern);

        $this->getJson('/api/intern/activities')->assertOk()->assertJsonPath('starts_on', '2026-07-31');
    }
}
