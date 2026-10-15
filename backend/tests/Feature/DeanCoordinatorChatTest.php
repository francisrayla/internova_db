<?php

namespace Tests\Feature;

use App\Models\DeanProfile;
use App\Models\Message;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The school's head (role dean) and its coordinator can chat 1:1, and nobody else can cross that line. */
class DeanCoordinatorChatTest extends TestCase
{
    use RefreshDatabase;

    private User $dean;
    private User $coordinator;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dean = User::where('email', 'dean@internova.test')->firstOrFail();
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
    }

    private function otherSchoolUser(string $role, string $email): User
    {
        $school = School::firstWhere('school_code', 'OTHER-1') ?? School::create([
            'school_code' => 'OTHER-1', 'school_name' => 'Other College', 'address' => 'Manila',
            'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active',
        ]);

        return User::create([
            'name' => "Other $role", 'email' => $email, 'password' => bcrypt('password'),
            'role_id' => Role::where('name', $role)->value('id'), 'school_id' => $school->id,
            'first_name' => 'Other', 'last_name' => ucfirst($role), 'status' => 'active', 'email_verified_at' => now(),
        ]);
    }

    public function test_coordinator_and_dean_message_each_other_in_both_directions(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->getJson('/api/messages/contacts')->assertOk()->assertJsonFragment(['id' => $this->dean->id, 'role' => 'dean']);
        $this->postJson('/api/messages', ['receiver_id' => $this->dean->id, 'message' => 'Good morning'])->assertOk();

        Sanctum::actingAs($this->dean);
        $this->getJson('/api/messages/contacts')->assertOk()->assertJsonFragment(['id' => $this->coordinator->id, 'unread_count' => 1]);
        $this->getJson("/api/messages/thread/{$this->coordinator->id}")->assertOk()->assertJsonPath('messages.0.message', 'Good morning');
        $this->postJson('/api/messages', ['receiver_id' => $this->coordinator->id, 'message' => 'Noted'])->assertOk();

        $this->assertSame(2, Message::count());
        $this->assertDatabaseHas('messages', ['sender_id' => $this->dean->id, 'receiver_id' => $this->coordinator->id, 'school_id' => $this->dean->school_id]);
    }

    public function test_dean_contacts_are_only_the_schools_own_coordinator(): void
    {
        $otherCoordinator = $this->otherSchoolUser('coordinator', 'othercoord@internova.test');

        Sanctum::actingAs($this->dean);
        $ids = collect($this->getJson('/api/messages/contacts')->assertOk()->json('contacts'))->pluck('id')->all();

        $this->assertSame([$this->coordinator->id], $ids);
        $this->assertNotContains($otherCoordinator->id, $ids);
    }

    public function test_dean_contact_carries_the_head_title_not_the_word_dean(): void
    {
        DeanProfile::where('user_id', $this->dean->id)->update(['position' => 'Principal']);

        Sanctum::actingAs($this->coordinator);
        $contact = collect($this->getJson('/api/messages/contacts')->assertOk()->json('contacts'))->firstWhere('id', $this->dean->id);

        $this->assertSame('dean', $contact['role']);
        $this->assertSame('Principal', $contact['role_label']);
    }

    public function test_nobody_crosses_schools_or_reaches_the_dean_outside_the_coordinator(): void
    {
        $otherDean = $this->otherSchoolUser('dean', 'otherdean@internova.test');
        $otherCoordinator = $this->otherSchoolUser('coordinator', 'othercoord@internova.test');

        Sanctum::actingAs($this->coordinator);
        $this->postJson('/api/messages', ['receiver_id' => $otherDean->id, 'message' => 'hi'])->assertForbidden();
        $this->getJson("/api/messages/thread/{$otherDean->id}")->assertForbidden();

        Sanctum::actingAs($this->dean);
        $this->postJson('/api/messages', ['receiver_id' => $otherCoordinator->id, 'message' => 'hi'])->assertForbidden();
        $this->postJson('/api/messages', ['receiver_id' => $otherDean->id, 'message' => 'hi'])->assertForbidden();

        // Same school but not the coordinator: supervisors and interns stay out of the dean's chat, and the reverse.
        foreach (['supervisor@internova.test', 'intern@internova.test'] as $email) {
            $other = User::where('email', $email)->first();
            if (!$other) {
                continue;
            }
            Sanctum::actingAs($this->dean);
            $this->postJson('/api/messages', ['receiver_id' => $other->id, 'message' => 'hi'])->assertForbidden();
            Sanctum::actingAs($other);
            $this->postJson('/api/messages', ['receiver_id' => $this->dean->id, 'message' => 'hi'])->assertForbidden();
        }

        $this->assertSame(0, Message::count());
    }

    public function test_an_inactive_head_is_not_a_contact_and_the_head_is_never_added_to_a_group(): void
    {
        Sanctum::actingAs($this->coordinator);
        $supervisor = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->postJson('/api/messages/groups', ['member_ids' => [$this->dean->id, $supervisor->id]])->assertStatus(422);

        $this->dean->update(['status' => 'inactive']);
        $this->postJson('/api/messages', ['receiver_id' => $this->dean->id, 'message' => 'hi'])->assertForbidden();
    }
}
