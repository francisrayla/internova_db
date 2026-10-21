<?php

namespace Tests\Feature;

use App\Events\GroupMessageUnsent;
use App\Events\MessageSent;
use App\Events\MessageUnsent;
use App\Models\GroupConversation;
use App\Models\GroupMessage;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A sender can unsend their own messages (1:1, group and replies): content is wiped for everyone, the row stays as a placeholder. */
class MessageUnsendTest extends TestCase
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

    private function dm(User $from, User $to, string $text, array $extra = []): Message
    {
        return Message::create(array_merge([
            'sender_id' => $from->id, 'receiver_id' => $to->id, 'school_id' => $from->school_id, 'message' => $text,
        ], $extra));
    }

    private function group(): GroupConversation
    {
        $group = GroupConversation::create(['name' => 'Team', 'created_by' => $this->coord->id, 'school_id' => $this->coord->school_id]);
        foreach ([$this->coord, $this->sup, $this->intern] as $u) {
            $group->members()->create(['user_id' => $u->id]);
        }

        return $group;
    }

    public function test_sender_unsends_own_direct_message(): void
    {
        $m = $this->dm($this->coord, $this->sup, 'secret plan');

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$m->id}")
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('message_data.unsent', true)
            ->assertJsonPath('message_data.message', '');

        $m->refresh();
        $this->assertNotNull($m->unsent_at);
        $this->assertSame('', $m->message);
        $this->assertDatabaseCount('messages', 1);

        // Doing it again is harmless.
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();
    }

    public function test_sender_unsends_own_group_message(): void
    {
        $group = $this->group();
        $gm = $group->messages()->create(['sender_id' => $this->sup->id, 'message' => 'group secret']);

        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$gm->id}")
            ->assertOk()
            ->assertJsonPath('message_data.unsent', true)
            ->assertJsonPath('message_data.message', '');

        $gm->refresh();
        $this->assertNotNull($gm->unsent_at);
        $this->assertSame('', $gm->message);
        $this->assertDatabaseCount('group_messages', 1);

        Sanctum::actingAs($this->intern);
        $this->getJson("/api/messages/groups/{$group->id}")
            ->assertOk()
            ->assertJsonPath('messages.0.unsent', true)
            ->assertJsonPath('messages.0.message', '');
    }

    public function test_cannot_unsend_someone_elses_message(): void
    {
        $m = $this->dm($this->coord, $this->sup, 'mine');
        $group = $this->group();
        $gm = $group->messages()->create(['sender_id' => $this->coord->id, 'message' => 'group mine']);
        $sys = $group->messages()->create(['sender_id' => $this->coord->id, 'message' => 'created the group.', 'is_system' => true]);

        // The receiver of a 1:1 message, and a group member who isn't the sender: 403.
        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/messages/{$m->id}")->assertForbidden();
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$gm->id}")->assertForbidden();

        // Group system lines can't be unsent, even by the one who "sent" them.
        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$sys->id}")->assertForbidden();

        // Outside the conversation entirely: 404, and nothing changed.
        Sanctum::actingAs($this->intern);
        $this->deleteJson("/api/messages/{$m->id}")->assertNotFound();

        $this->assertNull($m->fresh()->unsent_at);
        $this->assertNull($gm->fresh()->unsent_at);
        $this->assertNull($sys->fresh()->unsent_at);
        $this->assertSame('mine', $m->fresh()->message);
    }

    public function test_unsent_message_hides_text_and_attachment_and_deletes_the_file(): void
    {
        Storage::disk('public')->put('message-attachments/1/photo.png', 'png-bytes');
        $m = $this->dm($this->coord, $this->sup, 'look at this', [
            'attachment_path' => 'message-attachments/1/photo.png', 'attachment_name' => 'photo.png',
            'attachment_type' => 'image/png', 'attachment_size' => 9,
        ]);

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();

        Storage::disk('public')->assertMissing('message-attachments/1/photo.png');

        foreach ([$this->coord, $this->sup] as $viewer) {
            Sanctum::actingAs($viewer);
            $other = $viewer->is($this->coord) ? $this->sup : $this->coord;
            $row = $this->getJson("/api/messages/thread/{$other->id}")->assertOk()->json('messages.0');
            $this->assertTrue($row['unsent']);
            $this->assertSame('', $row['message']);
            $this->assertNull($row['attachment_url']);
            $this->assertNull($row['attachment_name']);
            $this->assertNull($row['attachment_type']);
            $this->assertNull($row['attachment_size']);
        }
        $this->assertStringNotContainsString('look at this', json_encode($this->getJson("/api/messages/thread/{$this->coord->id}")->json()));
    }

    public function test_a_file_still_used_by_a_forwarded_copy_is_kept(): void
    {
        Storage::disk('public')->put('message-attachments/1/shared.pdf', 'pdf');
        $attachment = ['attachment_path' => 'message-attachments/1/shared.pdf', 'attachment_name' => 'shared.pdf', 'attachment_type' => 'application/pdf', 'attachment_size' => 3];
        $original = $this->dm($this->coord, $this->sup, '', $attachment);
        $this->dm($this->coord, $this->intern, '', $attachment);

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$original->id}")->assertOk();

        Storage::disk('public')->assertExists('message-attachments/1/shared.pdf');
        $this->assertNull($original->fresh()->attachment_path);
    }

    public function test_a_group_attachment_file_is_deleted_on_unsend(): void
    {
        $group = $this->group();
        Storage::disk('public')->put('message-attachments/2/doc.pdf', 'pdf');
        $gm = $group->messages()->create([
            'sender_id' => $this->coord->id, 'message' => '', 'attachment_path' => 'message-attachments/2/doc.pdf',
            'attachment_name' => 'doc.pdf', 'attachment_type' => 'application/pdf', 'attachment_size' => 3,
        ]);

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$gm->id}")->assertOk()->assertJsonPath('message_data.attachment_url', null);

        Storage::disk('public')->assertMissing('message-attachments/2/doc.pdf');
    }

    public function test_a_reply_to_an_unsent_message_shows_the_unsent_state_and_can_itself_be_unsent(): void
    {
        $original = $this->dm($this->coord, $this->sup, 'the original words');

        Sanctum::actingAs($this->sup);
        $replyId = $this->postJson('/api/messages', ['receiver_id' => $this->coord->id, 'message' => 'my reply', 'reply_to_id' => $original->id])
            ->assertOk()->json('message_data.id');

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$original->id}")->assertOk();

        Sanctum::actingAs($this->sup);
        $thread = $this->getJson("/api/messages/thread/{$this->coord->id}")->assertOk();
        $reply = collect($thread->json('messages'))->firstWhere('id', $replyId);
        $this->assertSame('my reply', $reply['message']);
        $this->assertFalse($reply['unsent']);
        $this->assertTrue($reply['reply_to']['unsent']);
        $this->assertNull($reply['reply_to']['preview']);
        $this->assertStringNotContainsString('the original words', $thread->getContent());

        // The reply is a normal message: its own sender can unsend it too.
        $this->deleteJson("/api/messages/{$replyId}")->assertOk()->assertJsonPath('message_data.unsent', true);
        $this->assertSame('', Message::find($replyId)->message);
    }

    public function test_a_group_reply_to_an_unsent_message_shows_the_unsent_state(): void
    {
        $group = $this->group();
        $original = $group->messages()->create(['sender_id' => $this->coord->id, 'message' => 'old group words']);
        $reply = $group->messages()->create(['sender_id' => $this->sup->id, 'message' => 'group reply', 'reply_to_id' => $original->id]);

        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$original->id}")->assertOk();

        Sanctum::actingAs($this->intern);
        $thread = $this->getJson("/api/messages/groups/{$group->id}")->assertOk();
        $row = collect($thread->json('messages'))->firstWhere('id', $reply->id);
        $this->assertTrue($row['reply_to']['unsent']);
        $this->assertNull($row['reply_to']['preview']);
        $this->assertStringNotContainsString('old group words', $thread->getContent());
    }

    public function test_cannot_reply_to_or_forward_an_unsent_message(): void
    {
        $original = $this->dm($this->coord, $this->sup, 'gone soon');
        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$original->id}")->assertOk();

        $this->postJson('/api/messages', ['receiver_id' => $this->sup->id, 'message' => 'late reply', 'reply_to_id' => $original->id])
            ->assertOk()->assertJsonPath('message_data.reply_to', null);
        $this->postJson('/api/messages/forward', ['source_type' => 'dm', 'source_id' => $original->id, 'target_type' => 'dm', 'target_id' => $this->intern->id])
            ->assertNotFound();
    }

    public function test_thread_preview_does_not_leak_the_old_text(): void
    {
        $m = $this->dm($this->coord, $this->sup, 'top secret preview');
        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();

        $mine = $this->getJson('/api/messages/contacts')->assertOk();
        $row = collect($mine->json('contacts'))->firstWhere('id', $this->sup->id);
        $this->assertSame('You unsent a message', $row['last_message']);
        $this->assertTrue($row['last_message_unsent']);
        $this->assertStringNotContainsString('top secret preview', $mine->getContent());

        Sanctum::actingAs($this->sup);
        $theirs = $this->getJson('/api/messages/contacts')->assertOk();
        $row = collect($theirs->json('contacts'))->firstWhere('id', $this->coord->id);
        $this->assertSame("{$this->coord->first_name} unsent a message", $row['last_message']);
        $this->assertStringNotContainsString('top secret preview', $theirs->getContent());
    }

    public function test_group_preview_does_not_leak_the_old_text(): void
    {
        $group = $this->group();
        $group->messages()->create(['sender_id' => $this->sup->id, 'message' => 'hidden group preview']);
        $last = $group->messages()->latest('id')->first();

        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$last->id}")->assertOk();

        $mine = $this->getJson('/api/messages/groups')->assertOk();
        $this->assertSame('You unsent a message', $mine->json('groups.0.last_message'));

        Sanctum::actingAs($this->intern);
        $theirs = $this->getJson('/api/messages/groups')->assertOk();
        $this->assertSame("{$this->sup->first_name} unsent a message", $theirs->json('groups.0.last_message'));
        $this->assertTrue($theirs->json('groups.0.last_message_unsent'));
        $this->assertStringNotContainsString('hidden group preview', $theirs->getContent());
    }

    public function test_unsending_broadcasts_to_the_other_people_and_creates_no_notification(): void
    {
        $m = $this->dm($this->coord, $this->sup, 'oops');
        $group = $this->group();
        $gm = $group->messages()->create(['sender_id' => $this->coord->id, 'message' => 'oops group']);
        $before = Notification::count();

        Event::fake([MessageUnsent::class, GroupMessageUnsent::class, MessageSent::class]);
        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();
        $this->deleteJson("/api/messages/groups/{$group->id}/messages/{$gm->id}")->assertOk();

        Event::assertDispatched(MessageUnsent::class, fn ($e) => $e->message->id === $m->id && $e->broadcastOn()[0]->name === "private-user.{$this->sup->id}.messages");
        Event::assertDispatched(GroupMessageUnsent::class, fn ($e) => $e->message->id === $gm->id
            && collect($e->recipientUserIds)->sort()->values()->all() === collect([$this->sup->id, $this->intern->id])->sort()->values()->all());
        Event::assertNotDispatched(MessageSent::class);
        $this->assertSame($before, Notification::count());

        // The payload carries ids only, never the old content.
        $payload = (new MessageUnsent($m->fresh()))->broadcastWith();
        $this->assertSame(['id', 'sender_id', 'receiver_id'], array_keys($payload));
    }

    public function test_a_second_unsend_does_not_broadcast_again(): void
    {
        $m = $this->dm($this->coord, $this->sup, 'once');
        Sanctum::actingAs($this->coord);
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();

        Event::fake([MessageUnsent::class]);
        $this->deleteJson("/api/messages/{$m->id}")->assertOk();
        Event::assertNotDispatched(MessageUnsent::class);
    }
}
