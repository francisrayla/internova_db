<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Opening the bell clears the red number even if no single notification was opened.
 */
class NotificationSeenTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        Notification::query()->delete();
        Carbon::setTestNow(Carbon::parse('2026-10-14 01:00:00', 'UTC'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function bell(): array
    {
        Sanctum::actingAs($this->sup);

        return $this->getJson("/api/notifications?audience_role=supervisor&school_id={$this->sup->school_id}&user_id={$this->sup->id}")->assertOk()->json();
    }

    private function notify(string $title): void
    {
        NotificationService::toUser('supervisor', $this->sup->id, $this->sup->school_id, 'test', $title);
    }

    public function test_opening_the_bell_clears_the_number_but_not_the_unread_dots(): void
    {
        $this->notify('One');
        $this->notify('Two');
        $before = $this->bell();
        $this->assertSame([2, 2], [$before['unread_count'], $before['new_count']]);

        $this->postJson('/api/notifications/seen')->assertOk();

        $after = $this->bell();
        $this->assertSame(0, $after['new_count']);
        $this->assertSame(2, $after['unread_count']); // still unread until clicked
        $this->assertSame([false, false], collect($after['notifications'])->pluck('read')->all());
    }

    public function test_a_notification_that_arrives_later_shows_again(): void
    {
        $this->notify('One');
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/notifications/seen')->assertOk();

        Carbon::setTestNow(now()->addMinute());
        $this->notify('Two');

        $bell = $this->bell();
        $this->assertSame([2, 1], [$bell['unread_count'], $bell['new_count']]);
    }

    public function test_seeing_is_per_person(): void
    {
        $this->notify('One');
        $other = User::where('email', 'coordinator@internova.test')->firstOrFail();
        NotificationService::toUser('coordinator', $other->id, $other->school_id, 'test', 'For the coordinator');

        Sanctum::actingAs($this->sup);
        $this->postJson('/api/notifications/seen')->assertOk();

        Sanctum::actingAs($other);
        $res = $this->getJson("/api/notifications?audience_role=coordinator&school_id={$other->school_id}&user_id={$other->id}")->assertOk();
        $this->assertSame(1, $res->json('new_count'));
    }

    public function test_marking_one_as_read_lowers_the_unread_count_only(): void
    {
        $this->notify('One');
        $id = $this->bell()['notifications'][0]['id'];
        $this->postJson("/api/notifications/{$id}/read")->assertOk();

        $bell = $this->bell();
        $this->assertSame([0, 0], [$bell['unread_count'], $bell['new_count']]);
    }
}
