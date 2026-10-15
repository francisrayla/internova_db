<?php

namespace Tests\Feature;

use App\Models\DeanProfile;
use App\Models\PlanInquiry;
use App\Models\User;
use App\Support\HeadTitle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Artisan;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The school head's title (Dean / Principal / School Head) is what the app shows; the role key stays 'dean'. */
class HeadTitleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function user(string $email): User
    {
        return User::where('email', $email)->first();
    }

    private function setTitle(string $title): void
    {
        DeanProfile::where('user_id', $this->user('dean@internova.test')->id)->update(['position' => $title]);
    }

    private function register(string $position): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/inquiries', [
            'school_name' => 'New College', 'contact_person' => 'Pat Head', 'position' => $position,
            'email' => 'pat@newcollege.test', 'phone' => '09171234567', 'message' => 'Hello',
            'password' => 'password123', 'password_confirmation' => 'password123', 'accept_terms' => true, 'accept_terms' => true,
        ]);
    }

    public function test_normalize_keeps_the_three_options_and_defaults_to_dean(): void
    {
        $this->assertSame('Principal', HeadTitle::normalize('principal'));
        $this->assertSame('School Head', HeadTitle::normalize('  school   head '));
        $this->assertSame('Dean', HeadTitle::normalize(null));
        $this->assertSame('Dean', HeadTitle::normalize('Janitor'));
    }

    public function test_registration_only_accepts_the_known_positions(): void
    {
        $this->register('Janitor')->assertStatus(422)->assertJsonValidationErrors('position');
        $this->register('School Head')->assertCreated();
        $this->assertSame('School Head', PlanInquiry::where('email', 'pat@newcollege.test')->value('position'));
    }

    public function test_session_payload_gives_the_title_to_the_dean_and_to_the_coordinator(): void
    {
        $this->setTitle('Principal');

        $dean = $this->user('dean@internova.test');
        Sanctum::actingAs($dean);
        $this->getJson("/api/auth/session/{$dean->id}")->assertOk()->assertJsonPath('user.head_title', 'Principal')->assertJsonPath('user.role', 'dean');

        $coordinator = $this->user('coordinator@internova.test');
        Sanctum::actingAs($coordinator);
        $this->getJson("/api/auth/session/{$coordinator->id}")->assertOk()->assertJsonPath('user.head_title', 'Principal');
    }

    public function test_dean_changes_the_title_and_only_to_a_known_option(): void
    {
        Sanctum::actingAs($this->user('dean@internova.test'));

        $this->patchJson('/api/dean/head-title', ['head_title' => 'Principal'])->assertOk()->assertJsonPath('head_title', 'Principal');
        $this->assertSame('Principal', DeanProfile::where('user_id', $this->user('dean@internova.test')->id)->value('position'));
        $this->patchJson('/api/dean/head-title', ['head_title' => 'King'])->assertStatus(422);
        $this->patchJson('/api/dean/head-title', [])->assertStatus(422);

        Sanctum::actingAs($this->user('coordinator@internova.test'));
        $this->patchJson('/api/dean/head-title', ['head_title' => 'Dean'])->assertForbidden();
    }

    public function test_superadmin_schools_list_shows_the_head_title(): void
    {
        $this->setTitle('School Head');
        Sanctum::actingAs($this->user('superadmin@internova.test'));

        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('dean_email', 'dean@internova.test');
        $this->assertSame('School Head', $row['dean_title']);
    }

    public function test_feedback_notifications_to_the_coordinator_use_the_title(): void
    {
        $this->setTitle('Principal');
        Sanctum::actingAs($this->user('dean@internova.test'));

        $this->postJson('/api/dean/coordinator/feedback', ['message' => 'Please review the late logs.'])->assertCreated();

        $this->assertDatabaseHas('notifications', ['type' => 'dean_feedback', 'title' => 'New feedback from your Principal']);
    }

    public function test_backfill_migration_fixes_old_values(): void
    {
        $dean = $this->user('dean@internova.test');
        PlanInquiry::create([
            'school_name' => 'ABC', 'contact_person' => 'Dean', 'position' => 'Principal', 'email' => 'dean@internova.test',
            'phone' => '09171234567', 'message' => 'x', 'status' => 'converted', 'user_id' => $dean->id,
        ]);
        $this->setTitle('Dean of Students');

        $this->runBackfill();
        $this->assertSame('Principal', DeanProfile::where('user_id', $dean->id)->value('position'));

        // No registration choice: unknown free text becomes Dean, an allowed one is left alone.
        PlanInquiry::where('user_id', $dean->id)->delete();
        $this->setTitle('VP for Academic Affairs');
        $this->runBackfill();
        $this->assertSame('Dean', DeanProfile::where('user_id', $dean->id)->value('position'));

        $this->setTitle('School Head');
        $this->runBackfill();
        $this->assertSame('School Head', DeanProfile::where('user_id', $dean->id)->value('position'));
    }

    private function runBackfill(): void
    {
        (require base_path('database/migrations/2026_10_19_000000_normalize_dean_head_titles.php'))->up();
    }
}
