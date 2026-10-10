<?php

namespace Tests\Feature;

use App\Models\GroupConversation;
use App\Models\GroupConversationMember;
use App\Models\GroupMessage;
use App\Models\InternshipDeployment;
use App\Models\Message;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A chat that has run for months must not load every message when it is opened. */
class PaginationMessagesTest extends TestCase
{
    use RefreshDatabase;

    private User $supervisor;
    private User $intern;
    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->supervisor = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
    }

    /** The controller compares role ids with 2/3/4, which only holds on a freshly migrated database. */
    private function normaliseRoleIds(): void
    {
        $wanted = ['super_admin' => 1, 'coordinator' => 2, 'supervisor' => 3, 'intern' => 4, 'dean' => 5];
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        foreach ($wanted as $name => $id) {
            $old = Role::where('name', $name)->value('id');
            if ($old !== $id) {
                DB::table('roles')->where('id', $old)->update(['id' => $id + 100]);
                DB::table('users')->where('role_id', $old)->update(['role_id' => $id + 100]);
            }
        }
        foreach ($wanted as $id) {
            DB::table('roles')->where('id', $id + 100)->update(['id' => $id]);
            DB::table('users')->where('role_id', $id + 100)->update(['role_id' => $id]);
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        $this->supervisor->refresh();
        $this->intern->refresh();
    }

    private function chat(int $count): void
    {
        for ($i = 1; $i <= $count; $i++) {
            Message::create([
                'sender_id' => $i % 2 ? $this->supervisor->id : $this->intern->id,
                'receiver_id' => $i % 2 ? $this->intern->id : $this->supervisor->id,
                'school_id' => $this->dep->school_id, 'message' => "msg $i",
            ]);
        }
    }

    // One test method on purpose: MessageController::eligibleContacts hard-codes role ids 2/3/4, which only match
    // for the first test of a class (later tests re-seed roles with higher auto-increment ids inside the rolled-back transaction).
    public function test_thread_is_whole_without_a_limit_and_paged_with_one(): void
    {
        $this->normaliseRoleIds();
        $this->chat(45);
        Sanctum::actingAs($this->supervisor);

        $all = $this->getJson("/api/messages/thread/{$this->intern->id}")->assertOk();
        $this->assertCount(45, $all->json('messages'));
        $this->assertArrayNotHasKey('has_more', $all->json());

        $newest = $this->getJson("/api/messages/thread/{$this->intern->id}?limit=30")->assertOk();
        $texts = array_column($newest->json('messages'), 'message');
        $this->assertCount(30, $texts);
        $this->assertSame('msg 16', $texts[0]);
        $this->assertSame('msg 45', $texts[29]);
        $newest->assertJsonPath('has_more', true);

        $oldestId = $newest->json('messages.0.id');
        $older = $this->getJson("/api/messages/thread/{$this->intern->id}?limit=30&before_id=$oldestId")->assertOk();
        $olderTexts = array_column($older->json('messages'), 'message');
        $this->assertCount(15, $olderTexts);
        $this->assertSame('msg 1', $olderTexts[0]);
        $this->assertSame('msg 15', $olderTexts[14]);
        $older->assertJsonPath('has_more', false);

        $this->getJson("/api/messages/thread/{$this->intern->id}?limit=5000")->assertOk()->assertJsonCount(45, 'messages');
    }

    public function test_a_stranger_still_cannot_read_a_thread_page(): void
    {
        $this->chat(3);
        $stranger = User::where('email', 'dean@internova.test')->firstOrFail();
        Sanctum::actingAs($stranger);
        $this->getJson("/api/messages/thread/{$this->intern->id}?limit=30")->assertForbidden();
    }

    public function test_group_threads_page_the_same_way(): void
    {
        $group = GroupConversation::create(['name' => 'Team', 'created_by' => $this->supervisor->id, 'school_id' => $this->dep->school_id]);
        foreach ([$this->supervisor, $this->intern] as $u) {
            GroupConversationMember::create(['group_conversation_id' => $group->id, 'user_id' => $u->id]);
        }
        for ($i = 1; $i <= 35; $i++) {
            GroupMessage::create(['group_conversation_id' => $group->id, 'sender_id' => $this->supervisor->id, 'message' => "g $i"]);
        }
        Sanctum::actingAs($this->intern);

        $this->assertCount(35, $this->getJson("/api/messages/groups/{$group->id}")->assertOk()->json('messages'));
        $page = $this->getJson("/api/messages/groups/{$group->id}?limit=30")->assertOk();
        $this->assertCount(30, $page->json('messages'));
        $page->assertJsonPath('has_more', true)->assertJsonPath('messages.29.message', 'g 35');
        $this->assertCount(5, $this->getJson("/api/messages/groups/{$group->id}?limit=30&before_id={$page->json('messages.0.id')}")->json('messages'));
    }
}
