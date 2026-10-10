<?php

namespace Tests\Feature;

use App\Mail\AccountInvitation;
use App\Models\CoordinatorProfile;
use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DeanTest extends TestCase
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

    private function dean(): User
    {
        return $this->user('dean@internova.test');
    }

    /** A school that registered before the Dean role: coordinator only. */
    private function legacySchool(): School
    {
        $school = School::create(['school_code' => 'LEGACY-1', 'school_name' => 'Legacy College', 'address' => 'Manila', 'contact_email' => 'l@l.test', 'contact_number' => '09170000009', 'status' => 'active']);
        $coordinator = User::create([
            'name' => 'Legacy Coordinator', 'email' => 'legacy@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'coordinator')->value('id'), 'school_id' => $school->id,
            'first_name' => 'Legacy', 'last_name' => 'Coordinator', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        CoordinatorProfile::create(['user_id' => $coordinator->id, 'school_id' => $school->id, 'position' => 'Coordinator', 'is_primary_coordinator' => true]);

        return $school;
    }

    public function test_inquiry_creates_a_dean_and_converting_links_them_to_the_school(): void
    {
        SubscriptionPlan::firstOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'price' => 999, 'billing_cycle' => 'monthly', 'is_active' => true]);

        $this->postJson('/api/inquiries', [
            'school_name' => 'New College', 'contact_person' => 'Pat Principal', 'position' => 'Principal',
            'email' => 'pat@newcollege.test', 'phone' => '09171234567', 'message' => 'Hello',
            'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertCreated();

        $user = $this->user('pat@newcollege.test');
        $this->assertSame('dean', $user->roles->name);
        $this->assertSame('pending_approval', $user->status);

        $inquiry = PlanInquiry::where('user_id', $user->id)->first();
        $user->update(['email_verified_at' => now()]);

        Sanctum::actingAs($this->user('superadmin@internova.test'));
        $this->postJson("/api/superadmin/plan-inquiries/{$inquiry->id}/convert-to-school", [
            'school_name' => 'New College', 'school_code' => 'NEW-1', 'contact_email' => 'info@newcollege.test',
            'plan_name' => 'Basic', 'billing_period' => 'monthly',
            'list_price' => (float) SubscriptionPlan::where('name', 'Basic')->value('monthly_price'),
            'amount' => (float) SubscriptionPlan::where('name', 'Basic')->value('monthly_price'),
        ])->assertCreated();

        $user->refresh();
        $this->assertNotNull($user->school_id);
        $this->assertSame('active', $user->status);
        $this->assertSame('Principal', $user->deanProfile->position);
        $this->assertDatabaseMissing('coordinator_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('notifications', ['audience_role' => 'dean', 'user_id' => $user->id, 'type' => 'offer_sent']);

        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('name', 'New College');
        $this->assertSame('pat@newcollege.test', $row['dean_email']);
        $this->assertSame('active', $row['dean_setup']);
    }

    public function test_dean_runs_billing_actions_and_the_coordinator_cannot(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        $school->subscriptions()->update(['status' => 'awaiting_acceptance', 'offer_expires_at' => now()->addDays(5)]);

        Sanctum::actingAs($this->user('coordinator@internova.test'));
        $this->postJson("/api/dean/schools/{$school->id}/accept-offer")->assertForbidden();
        $this->postJson("/api/coordinator/schools/{$school->id}/accept-offer")->assertStatus(404);
        $this->getJson("/api/coordinator/schools/{$school->id}/upgrade-quote")->assertStatus(404);

        // A dean of another school cannot touch this school either.
        $other = $this->legacySchool();
        $otherDean = User::create([
            'name' => 'Other Dean', 'email' => 'otherdean@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'dean')->value('id'), 'school_id' => $other->id,
            'first_name' => 'Other', 'last_name' => 'Dean', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        Sanctum::actingAs($otherDean);
        $this->postJson("/api/dean/schools/{$school->id}/accept-offer")->assertForbidden();

        Sanctum::actingAs($this->dean());
        $this->postJson("/api/dean/schools/{$school->id}/accept-offer")->assertOk();
        $this->assertSame('accepted', $school->subscriptions()->latest('id')->first()->status);
    }

    public function test_dean_invites_exactly_one_coordinator_and_can_replace_after_deactivation(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        Sanctum::actingAs($this->dean());

        // The seeded school already has an active coordinator.
        $this->postJson('/api/dean/coordinator/invite', ['name' => 'Second Coord', 'email' => 'second@gmail.com'])->assertStatus(422);

        $this->postJson('/api/dean/coordinator/deactivate')->assertOk();
        $old = $this->user('coordinator@internova.test');
        $old->update(['email' => 'oldcoord@gmail.com']);
        $this->assertSame('inactive', $old->status);
        $this->assertSame(0, $old->tokens()->count());

        $this->postJson('/api/dean/coordinator/invite', ['name' => 'New Coord', 'email' => 'newcoord@gmail.com'])->assertCreated();
        $new = $this->user('newcoord@gmail.com');
        $this->assertSame('coordinator', $new->roles->name);
        $this->assertSame('pending_activation', $new->status);
        $this->assertSame($school->id, $new->school_id);
        Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->roleLabel === 'Coordinator' && $m->hasTo('newcoord@gmail.com'));

        // Only one active-or-pending coordinator at a time.
        $this->postJson('/api/dean/coordinator/invite', ['name' => 'Third', 'email' => 'third@gmail.com'])->assertStatus(422);

        $this->postJson('/api/dean/coordinator/resend-invitation')->assertOk();
        $this->patchJson('/api/dean/coordinator/email', ['email' => 'fixed@gmail.com'])->assertOk();
        $this->assertSame('fixed@gmail.com', $new->fresh()->email);

        // Accepting the emailed link activates the account for login.
        $url = null;
        Mail::assertQueued(AccountInvitation::class, function ($m) use (&$url) {
            $url = $m->acceptUrl;
            return $m->hasTo('fixed@gmail.com');
        });
        $token = basename($url);
        $this->postJson("/api/invitations/{$token}/accept", ['password' => 'newpassword1', 'password_confirmation' => 'newpassword1'])->assertOk();
        $this->assertSame('active', $new->fresh()->status);
        $this->postJson('/api/auth/login', ['email' => 'fixed@gmail.com', 'password' => 'newpassword1'])->assertOk()->assertJsonPath('user.role', 'coordinator');

        // The deactivated coordinator can no longer sign in.
        $this->postJson('/api/auth/login', ['email' => 'oldcoord@gmail.com', 'password' => 'password'])->assertForbidden();

        // Re-inviting a deactivated coordinator's address reuses their account.
        $this->postJson('/api/dean/coordinator/deactivate')->assertOk();
        $this->postJson('/api/dean/coordinator/invite', ['name' => 'Maria Again', 'email' => 'oldcoord@gmail.com'])->assertCreated();
        $this->assertSame('pending_activation', $old->fresh()->status);
        $this->assertSame(1, User::where('email', 'oldcoord@gmail.com')->count());
    }

    public function test_coordinator_cannot_manage_a_deans_pending_account(): void
    {
        $school = $this->legacySchool();
        Sanctum::actingAs($this->user('superadmin@internova.test'));
        $this->postJson("/api/superadmin/schools/{$school->id}/invite-dean", ['name' => 'Legacy Dean', 'email' => 'legacydean@gmail.com'])->assertCreated();
        $dean = $this->user('legacydean@gmail.com');

        Sanctum::actingAs($this->user('legacy@internova.test'));
        $this->patchJson("/api/coordinator/users/{$dean->id}/email", ['email' => 'hijack@gmail.com'])->assertStatus(422);
        $this->assertSame('legacydean@gmail.com', $dean->fresh()->email);
    }

    public function test_superadmin_invites_a_dean_for_a_legacy_school_once(): void
    {
        $school = $this->legacySchool();
        Sanctum::actingAs($this->user('superadmin@internova.test'));

        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('name', 'Legacy College');
        $this->assertNull($row['dean_email']);

        $this->postJson("/api/superadmin/schools/{$school->id}/invite-dean", ['name' => 'Legacy Dean', 'email' => 'legacydean@gmail.com'])->assertCreated();
        Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->roleLabel === 'Dean' && $m->hasTo('legacydean@gmail.com'));

        $dean = $this->user('legacydean@gmail.com');
        $this->assertSame('dean', $dean->roles->name);
        $this->assertSame('pending_activation', $dean->status);
        $this->assertDatabaseHas('dean_profiles', ['user_id' => $dean->id, 'school_id' => $school->id]);
        // The existing coordinator stays.
        $this->assertSame('active', $this->user('legacy@internova.test')->status);

        $this->postJson("/api/superadmin/schools/{$school->id}/invite-dean", ['name' => 'Another', 'email' => 'another@gmail.com'])->assertStatus(422);

        $this->postJson("/api/superadmin/schools/{$school->id}/resend-dean-invitation")->assertOk();
        Mail::assertQueued(AccountInvitation::class, 2);

        $row = collect($this->getJson('/api/superadmin/schools')->json('schools'))->firstWhere('name', 'Legacy College');
        $this->assertSame('pending', $row['dean_setup']);
    }

    public function test_school_settings_are_editable_by_the_dean_only(): void
    {
        $payload = ['school_name' => 'Renamed College', 'address' => 'Pasig', 'contact_email' => 'new@abctech.edu', 'contact_number' => '09175550000'];

        Sanctum::actingAs($this->user('coordinator@internova.test'));
        $this->patchJson('/api/coordinator/school-settings', $payload)->assertStatus(405);
        $this->patchJson('/api/dean/school-settings', $payload)->assertForbidden();
        $this->getJson('/api/coordinator/school-settings')->assertOk()->assertJsonPath('school.school_name', 'ABC Technical College');

        Sanctum::actingAs($this->dean());
        $this->patchJson('/api/dean/school-settings', $payload)->assertOk()->assertJsonPath('school.school_name', 'Renamed College');
        $this->patchJson('/api/dean/school-settings', [...$payload, 'contact_number' => '123'])->assertStatus(422);
    }

    public function test_dean_dashboard_and_login_payload(): void
    {
        $login = $this->postJson('/api/auth/login', ['email' => 'dean@internova.test', 'password' => 'password'])
            ->assertOk()
            ->assertJsonPath('user.role', 'dean')
            ->assertJsonPath('user.subscription_status', 'active')
            ->assertJsonPath('user.dean_position', 'Dean');

        $this->withToken($login->json('token'))->getJson('/api/dean/dashboard')
            ->assertOk()
            ->assertJsonPath('subscription.status', 'active')
            ->assertJsonPath('coordinator.email', 'coordinator@internova.test')
            ->assertJsonPath('counts.supervisors', 1)
            ->assertJsonPath('counts.interns', 1);

        $this->withToken($login->json('token'))->getJson('/api/auth/session/' . $this->dean()->id)->assertOk()->assertJsonPath('user.role', 'dean');

        // Messaging is not built for deans yet but must not crash.
        $this->withToken($login->json('token'))->getJson('/api/messages/contacts')->assertOk();

        // Other roles are kept out of the dean area, and deans out of the coordinator area.
        Sanctum::actingAs($this->user('intern@internova.test'));
        $this->getJson('/api/dean/dashboard')->assertForbidden();
        Sanctum::actingAs($this->dean());
        $this->getJson('/api/coordinator/interns')->assertForbidden();
    }
}
