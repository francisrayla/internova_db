<?php

namespace Tests\Feature;

use App\Events\GroupMessageSent;
use App\Events\GroupUserTyping;
use App\Events\MessageSent;
use App\Events\NotificationCreated;
use App\Events\UserTyping;
use App\Models\GroupConversation;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * Notifications are scoped to the signed-in user (never to ids in the request), and every realtime
 * channel is private and authorized server-side.
 */
class RealtimeAccessTest extends TestCase
{
    use BuildsTenants, RefreshDatabase;

    private User $sup;
    private User $coord;
    private User $dean;
    private User $intern;
    private User $admin;
    private array $other;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->coord = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->dean = User::where('email', 'dean@internova.test')->firstOrFail();
        $this->intern = User::where('email', 'intern@internova.test')->firstOrFail();
        $this->admin = User::where('email', 'superadmin@internova.test')->firstOrFail();
        $this->other = $this->makeOtherSchool();
        Notification::query()->delete();
    }

    private function note(string $role, ?int $schoolId, ?int $userId, string $title): Notification
    {
        return Notification::create([
            'audience_role' => $role, 'school_id' => $schoolId, 'user_id' => $userId,
            'type' => 'test', 'title' => $title, 'body' => 'x', 'important' => true,
        ]);
    }

    // ---- notifications -------------------------------------------------

    public function test_index_and_history_ignore_audience_school_and_user_ids_from_the_request(): void
    {
        $this->note('supervisor', $this->sup->school_id, null, 'mine-audience');
        $this->note('supervisor', $this->sup->school_id, $this->sup->id, 'mine-personal');
        $this->note('supervisor', $this->other['school']->id, null, 'other-school-audience');
        $this->note('supervisor', $this->other['school']->id, $this->other['supervisor']->id, 'other-school-personal');
        $this->note('coordinator', $this->sup->school_id, null, 'other-role');
        $this->note('superadmin', null, null, 'platform');

        Sanctum::actingAs($this->sup);
        // The attacker asks for another school's supervisor feed, the super admin feed and the coordinator feed.
        foreach ([
            "audience_role=supervisor&school_id={$this->other['school']->id}&user_id={$this->other['supervisor']->id}",
            'audience_role=superadmin',
            'audience_role=coordinator&school_id='.$this->sup->school_id,
        ] as $query) {
            foreach (['/api/notifications', '/api/notifications/history'] as $url) {
                $titles = collect($this->getJson("$url?$query")->assertOk()->json('notifications'))->pluck('title')->sort()->values()->all();
                $this->assertSame(['mine-audience', 'mine-personal'], $titles, "$url?$query");
            }
        }
    }

    public function test_super_admin_sees_platform_notifications_only(): void
    {
        $this->note('superadmin', null, null, 'platform');
        $this->note('supervisor', $this->sup->school_id, null, 'school-thing');

        Sanctum::actingAs($this->admin);
        $titles = collect($this->getJson('/api/notifications?audience_role=supervisor')->assertOk()->json('notifications'))->pluck('title')->all();
        $this->assertSame(['platform'], $titles);
    }

    public function test_nobody_can_mark_someone_elses_notification_read(): void
    {
        $theirs = $this->note('supervisor', $this->other['school']->id, $this->other['supervisor']->id, 'theirs');
        $sameSchoolOtherRole = $this->note('coordinator', $this->sup->school_id, null, 'coordinator-only');
        $sameSchoolOtherPerson = $this->note('intern', $this->sup->school_id, $this->intern->id, 'for-intern');

        Sanctum::actingAs($this->sup);
        foreach ([$theirs, $sameSchoolOtherRole, $sameSchoolOtherPerson] as $n) {
            $this->postJson("/api/notifications/{$n->id}/read")->assertNotFound();
            $this->assertNull($n->fresh()->read_at, "{$n->title} must stay unread");
        }
        Sanctum::actingAs($this->coord);
        $this->postJson("/api/notifications/{$sameSchoolOtherRole->id}/read")->assertOk();
        $this->assertNotNull($sameSchoolOtherRole->fresh()->read_at);
    }

    public function test_mark_all_read_only_touches_the_callers_own_feed(): void
    {
        $mine = $this->note('supervisor', $this->sup->school_id, null, 'mine');
        $theirs = $this->note('supervisor', $this->other['school']->id, null, 'theirs');
        $otherPerson = $this->note('supervisor', $this->sup->school_id, $this->other['supervisor']->id, 'someone-else');

        Sanctum::actingAs($this->sup);
        // Asking for the other school / user must not change who gets marked.
        $this->postJson('/api/notifications/mark-all-read', [
            'audience_role' => 'supervisor', 'school_id' => $this->other['school']->id, 'user_id' => $this->other['supervisor']->id,
        ])->assertOk();

        $this->assertNotNull($mine->fresh()->read_at);
        $this->assertNull($theirs->fresh()->read_at);
        $this->assertNull($otherPerson->fresh()->read_at);
    }

    public function test_notification_routes_need_a_login(): void
    {
        $this->getJson('/api/notifications')->assertUnauthorized();
        $this->postJson('/api/notifications/1/read')->assertUnauthorized();
        $this->postJson('/api/notifications/mark-all-read')->assertUnauthorized();
    }

    // ---- events are private --------------------------------------------

    public function test_every_broadcast_event_uses_private_channels_only(): void
    {
        $msg = Message::create(['sender_id' => $this->coord->id, 'receiver_id' => $this->sup->id, 'school_id' => $this->coord->school_id, 'message' => 'hi']);
        $group = GroupConversation::create(['name' => 'g', 'created_by' => $this->coord->id, 'school_id' => $this->coord->school_id]);
        $gmsg = $group->messages()->create(['sender_id' => $this->coord->id, 'message' => 'yo']);

        $events = [
            new NotificationCreated($this->note('supervisor', $this->sup->school_id, null, 'a')),
            new NotificationCreated($this->note('superadmin', null, null, 'p')),
            new NotificationCreated($this->note('intern', $this->intern->school_id, $this->intern->id, 'personal')),
            new MessageSent($msg),
            new UserTyping($this->sup->id, $this->coord->id, 'x'),
            new GroupMessageSent($gmsg, [$this->sup->id, $this->intern->id]),
            new GroupUserTyping($group->id, [$this->sup->id], $this->coord->id, 'x'),
        ];

        foreach ($events as $event) {
            $this->assertInstanceOf(ShouldBroadcast::class, $event);
            foreach ($event->broadcastOn() as $channel) {
                $this->assertInstanceOf(PrivateChannel::class, $channel, get_class($event).' must not use a public channel');
            }
        }
    }

    public function test_a_personal_notification_goes_only_to_that_persons_channel(): void
    {
        $event = new NotificationCreated($this->note('supervisor', $this->sup->school_id, $this->sup->id, 'personal'));
        $this->assertSame(["private-user.{$this->sup->id}.notifications"], array_map(fn ($c) => $c->name, $event->broadcastOn()));

        $audience = new NotificationCreated($this->note('supervisor', $this->sup->school_id, null, 'all'));
        $this->assertSame(["private-school.{$this->sup->school_id}.supervisor.notifications"], array_map(fn ($c) => $c->name, $audience->broadcastOn()));

        $admin = new NotificationCreated($this->note('superadmin', null, null, 'all'));
        $this->assertSame(['private-superadmin.notifications'], array_map(fn ($c) => $c->name, $admin->broadcastOn()));
    }

    // ---- channel authorization ------------------------------------------

    /** Real signed auth responses need the reverb driver and its channel callbacks registered on it. */
    private function useReverbDriver(): void
    {
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'test-key',
            'broadcasting.connections.reverb.secret' => 'test-secret',
            'broadcasting.connections.reverb.app_id' => 'test-app',
        ]);
        Broadcast::purge();
        require base_path('routes/channels.php');
    }

    private function authorizeChannel(User $as, string $channel)
    {
        Sanctum::actingAs($as);

        return $this->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-$channel"]);
    }

    public function test_broadcasting_auth_needs_a_login_and_the_old_public_route_is_gone(): void
    {
        $this->useReverbDriver();
        $this->postJson('/api/broadcasting/auth', ['socket_id' => '1.2', 'channel_name' => "private-user.{$this->sup->id}.messages"])->assertUnauthorized();
        $this->postJson('/broadcasting/auth', ['socket_id' => '1.2', 'channel_name' => "private-user.{$this->sup->id}.messages"])->assertNotFound();
    }

    public function test_a_user_can_only_listen_to_their_own_personal_channels(): void
    {
        $this->useReverbDriver();
        foreach (['notifications', 'messages'] as $kind) {
            $this->authorizeChannel($this->sup, "user.{$this->sup->id}.$kind")->assertOk()->assertJsonStructure(['auth']);
            $this->authorizeChannel($this->sup, "user.{$this->coord->id}.$kind")->assertForbidden();
            $this->authorizeChannel($this->sup, "user.{$this->other['supervisor']->id}.$kind")->assertForbidden();
            $this->authorizeChannel($this->admin, "user.{$this->sup->id}.$kind")->assertForbidden(); // not even the super admin
        }
    }

    public function test_school_role_channels_need_the_same_school_and_role(): void
    {
        $this->useReverbDriver();
        $school = $this->sup->school_id;

        $this->authorizeChannel($this->sup, "school.$school.supervisor.notifications")->assertOk();
        $this->authorizeChannel($this->coord, "school.$school.coordinator.notifications")->assertOk();
        $this->authorizeChannel($this->dean, "school.$school.dean.notifications")->assertOk();
        $this->authorizeChannel($this->intern, "school.$school.intern.notifications")->assertOk();

        // right school, wrong role
        $this->authorizeChannel($this->sup, "school.$school.coordinator.notifications")->assertForbidden();
        $this->authorizeChannel($this->intern, "school.$school.dean.notifications")->assertForbidden();
        // right role, other school (both directions)
        $this->authorizeChannel($this->sup, "school.{$this->other['school']->id}.supervisor.notifications")->assertForbidden();
        $this->authorizeChannel($this->other['coordinator'], "school.$school.coordinator.notifications")->assertForbidden();
    }

    public function test_only_the_super_admin_can_listen_to_the_platform_channel(): void
    {
        $this->useReverbDriver();
        $this->authorizeChannel($this->admin, 'superadmin.notifications')->assertOk();
        foreach ([$this->dean, $this->coord, $this->sup, $this->intern] as $user) {
            $this->authorizeChannel($user, 'superadmin.notifications')->assertForbidden();
        }
    }

    public function test_unknown_channels_are_refused(): void
    {
        $this->useReverbDriver();
        $this->authorizeChannel($this->admin, 'conversation.1')->assertForbidden();
        $this->authorizeChannel($this->sup, "user.{$this->sup->id}-messages")->assertForbidden();
    }
}
