<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Message;
use App\Models\User;
use App\Support\ChatTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Messenger time labels (Philippine time) and who is offered as a new contact. */
class MessengerTimeAndContactsTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_the_label_is_today_yesterday_weekday_or_a_date(): void
    {
        // Wednesday 2026-10-14, 9:00 PM Manila (13:00 UTC).
        $now = Carbon::parse('2026-10-14 13:00:00', 'UTC');
        $at = fn (string $utc) => ChatTime::label(Carbon::parse($utc, 'UTC'), $now);

        $this->assertSame('Today 6:40 PM', $at('2026-10-14 10:40:00'));
        $this->assertSame('Today 12:05 AM', $at('2026-10-13 16:05:00')); // 00:05 on the 14th in Manila although it is the 13th in UTC
        $this->assertSame('Yesterday 6:40 PM', $at('2026-10-13 10:40:00'));
        $this->assertSame('Yesterday 11:59 PM', $at('2026-10-13 15:59:00'));
        $this->assertSame('Mon 6:40 PM', $at('2026-10-12 10:40:00'));
        $this->assertSame('Mon 12:05 AM', $at('2026-10-11 16:05:00')); // the week starts on Monday
        $this->assertSame('Oct 11, 11:59 PM', $at('2026-10-11 15:59:00')); // Sunday: last week, so a date
        $this->assertSame('Oct 9, 6:40 PM', $at('2026-10-09 10:40:00'));
        $this->assertSame('Jan 5, 6:40 PM', $at('2026-01-05 10:40:00'));
        $this->assertSame('Dec 31, 2025, 6:40 PM', $at('2025-12-31 10:40:00')); // other year: with the year
        $this->assertNull(ChatTime::label(null, $now));

        // On a Monday only today and yesterday (Sunday) are named; the rest of last week is a date.
        $monday = Carbon::parse('2026-10-19 13:00:00', 'UTC');
        $this->assertSame('Yesterday 6:40 PM', ChatTime::label(Carbon::parse('2026-10-18 10:40:00', 'UTC'), $monday));
        $this->assertSame('Oct 13, 6:40 PM', ChatTime::label(Carbon::parse('2026-10-13 10:40:00', 'UTC'), $monday));
    }

    public function test_the_label_uses_the_clock_by_default(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-14 13:00:00', 'UTC'));

        $this->assertSame('Today 6:40 PM', ChatTime::label(Carbon::parse('2026-10-14 10:40:00', 'UTC')));
    }

    public function test_the_conversation_list_and_the_bubbles_carry_the_label(): void
    {
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        Carbon::setTestNow(Carbon::parse('2026-10-14 13:00:00', 'UTC'));

        $old = Message::create(['sender_id' => $sup->id, 'receiver_id' => $coordinator->id, 'school_id' => $coordinator->school_id, 'message' => 'Hi']);
        $old->forceFill(['created_at' => Carbon::parse('2026-10-13 10:40:00', 'UTC')])->save();

        Sanctum::actingAs($coordinator);
        $contact = collect($this->getJson('/api/messages/contacts')->assertOk()->json('contacts'))->firstWhere('id', $sup->id);
        $this->assertSame('Yesterday 6:40 PM', $contact['last_message_at']);

        $thread = $this->getJson("/api/messages/thread/{$sup->id}")->assertOk();
        $thread->assertJsonPath('messages.0.created_at', 'Yesterday 6:40 PM')->assertJsonPath('messages.0.created_at_full', 'Oct 13, 2026 6:40 PM');
    }

    public function test_contacts_leave_out_people_who_have_not_set_up_or_are_inactive_but_old_chats_stay(): void
    {
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $deployments = InternshipDeployment::visibleToSupervisor($sup)->get();
        $this->assertGreaterThanOrEqual(1, $deployments->count());
        $intern = User::findOrFail($deployments->first()->intern_id);

        $ids = fn (User $u) => collect($this->getJson('/api/messages/contacts')->assertOk()->json('contacts'))->pluck('id')->all();

        Sanctum::actingAs($sup);
        $this->assertContains($intern->id, $ids($sup));
        $intern->update(['status' => 'pending_activation']);
        $this->assertNotContains($intern->id, $ids($sup));
        Sanctum::actingAs($coordinator);
        $this->assertNotContains($intern->id, $ids($coordinator));
        $intern->update(['status' => 'inactive']);
        $this->assertNotContains($intern->id, $ids($coordinator));

        // Nobody can start a conversation or a group with them either.
        $this->postJson('/api/messages', ['receiver_id' => $intern->id, 'message' => 'hello'])->assertStatus(422);
        $this->assertSame(0, Message::count());
        $other = User::where('role_id', $intern->role_id)->where('id', '!=', $intern->id)->where('school_id', $coordinator->school_id)->where('status', 'active')->first();
        if ($other) {
            $this->postJson('/api/messages/groups', ['member_ids' => [$intern->id]])->assertStatus(422);
        }

        // A conversation that already exists stays readable (and listed), even once they are inactive.
        Message::create(['sender_id' => $intern->id, 'receiver_id' => $coordinator->id, 'school_id' => $coordinator->school_id, 'message' => 'Old hello']);
        $this->assertContains($intern->id, $ids($coordinator));
        $this->getJson("/api/messages/thread/{$intern->id}")->assertOk()->assertJsonPath('messages.0.message', 'Old hello');
        $this->postJson('/api/messages', ['receiver_id' => $intern->id, 'message' => 'reply'])->assertStatus(422);

        // Active again: back to normal.
        $intern->update(['status' => 'active']);
        $this->postJson('/api/messages', ['receiver_id' => $intern->id, 'message' => 'welcome back'])->assertOk();
    }
}
