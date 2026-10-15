<?php

namespace Tests\Feature;

use App\Mail\AccountInvitation;
use App\Models\ActivityLog;
use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Supervisors are invited like interns (no shared password, the emailed link proves the inbox),
 * every address a coordinator types goes through CompleteEmail, and
 * `supervisors:default-password` locks accounts that still use the old default password.
 * Addresses use gmail.com on purpose: provider domains skip the DNS lookup.
 */
class SupervisorInvitationTest extends TestCase
{
    use RefreshDatabase;

    private User $coordinator;
    private Company $company;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->company = InternshipDeployment::firstOrFail()->company;
        Sanctum::actingAs($this->coordinator);
    }

    private function payload(array $over = []): array
    {
        return array_merge(['first_name' => 'Nina', 'last_name' => 'Lopez', 'email' => 'nina.lopez@gmail.com', 'company_id' => $this->company->id, 'position' => 'Supervisor'], $over);
    }

    private function inviteToken(User $user): string
    {
        $token = 'known-token';
        $user->update(['invitation_token' => hash('sha256', $token), 'invitation_expires_at' => now()->addDay()]);

        return $token;
    }

    // ---- creation = invitation flow

    public function test_adding_a_supervisor_sends_an_invitation_and_returns_no_password(): void
    {
        $res = $this->postJson('/api/coordinator/supervisors', $this->payload())->assertOk()->assertJsonPath('success', true);

        $this->assertArrayNotHasKey('temporary_password', $res->json());
        $this->assertArrayNotHasKey('password', $res->json());
        $this->assertStringNotContainsString('password', strtolower(json_encode($res->json())));

        $user = User::where('email', 'nina.lopez@gmail.com')->firstOrFail();
        $this->assertSame('pending_activation', $user->status);
        $this->assertNull($user->password);
        $this->assertNull($user->email_verified_at);
        $this->assertNotNull($user->invitation_token);
        $this->assertSame($this->company->id, SupervisorProfile::where('user_id', $user->id)->value('company_id'));

        Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->hasTo('nina.lopez@gmail.com') && $m->roleLabel === 'Supervisor');
        $this->assertTrue(ActivityLog::where('action', 'Invited supervisor')->exists());

        $row = collect($this->getJson('/api/coordinator/supervisors')->json('supervisors'))->firstWhere('user_id', $user->id);
        $this->assertSame('pending', $row['status']);
    }

    public function test_the_company_still_holds_at_most_two_supervisors(): void
    {
        $this->postJson('/api/coordinator/supervisors', $this->payload())->assertOk();
        $this->postJson('/api/coordinator/supervisors', $this->payload(['email' => 'third@gmail.com']))->assertStatus(422);
    }

    public function test_the_supervisor_cannot_log_in_before_setup_and_can_after_accepting(): void
    {
        $this->postJson('/api/coordinator/supervisors', $this->payload())->assertOk();
        $user = User::where('email', 'nina.lopez@gmail.com')->firstOrFail();

        // Neither the old shared password nor an empty one gets in.
        $this->postJson('/api/auth/login', ['email' => 'nina.lopez@gmail.com', 'password' => 'password'])->assertStatus(401);

        $token = $this->inviteToken($user);
        $this->postJson("/api/invitations/{$token}/accept", ['password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123', 'accept_terms' => true])->assertOk();

        $user->refresh();
        $this->assertSame('active', $user->status);
        $this->assertNotNull($user->email_verified_at);

        $this->postJson('/api/auth/login', ['email' => 'nina.lopez@gmail.com', 'password' => 'password'])->assertStatus(401);
        $this->postJson('/api/auth/login', ['email' => 'nina.lopez@gmail.com', 'password' => 'MyOwnPass123'])->assertOk();
    }

    // ---- email checks

    public function test_incomplete_emails_are_refused_for_supervisors_and_companies(): void
    {
        foreach (['juan@gmail', 'juan@gmail.c', 'juan@localhost', 'a..b@x.com', 'juan@gmail.', 'juan@.com', 'juan@@gmail.com', '@gmail.com'] as $bad) {
            $this->postJson('/api/coordinator/supervisors', $this->payload(['email' => $bad]))
                ->assertStatus(422)->assertJsonValidationErrors('email');
            $this->postJson('/api/coordinator/companies', ['company_name' => 'Bad Mail Inc', 'contact_email' => $bad])
                ->assertStatus(422)->assertJsonValidationErrors('contact_email');
        }

        $this->assertSame(0, User::where('email', 'like', 'juan@%')->count());
        $this->assertSame(0, Company::where('company_name', 'Bad Mail Inc')->count());
    }

    public function test_a_typo_domain_gets_a_did_you_mean_message(): void
    {
        $this->postJson('/api/coordinator/supervisors', $this->payload(['email' => 'juan@gmial.com']))
            ->assertStatus(422)->assertJsonValidationErrors('email')
            ->assertJsonPath('errors.email.0', 'Did you mean juan@gmail.com?')
            ->assertJsonPath('message', 'Did you mean juan@gmail.com?');

        $this->postJson('/api/coordinator/companies', ['company_name' => 'Typo Inc', 'contact_email' => 'hr@gmial.com'])
            ->assertStatus(422)->assertJsonPath('errors.contact_email.0', 'Did you mean hr@gmail.com?');
    }

    public function test_a_valid_address_passes_and_is_saved_lowercase(): void
    {
        $this->postJson('/api/coordinator/supervisors', $this->payload(['email' => '  Nina.Lopez@Gmail.COM ']))->assertOk();
        $this->assertDatabaseHas('users', ['email' => 'nina.lopez@gmail.com']);

        $this->postJson('/api/coordinator/companies', ['company_name' => 'Good Mail Inc', 'contact_email' => 'HR@Gmail.com'])->assertOk();
        $this->assertDatabaseHas('companies', ['company_name' => 'Good Mail Inc', 'contact_email' => 'hr@gmail.com']);

        // An empty contact email stays optional.
        $this->postJson('/api/coordinator/companies', ['company_name' => 'No Mail Inc', 'contact_email' => ''])->assertOk();
    }

    public function test_company_update_checks_the_contact_email(): void
    {
        $this->patchJson("/api/coordinator/companies/{$this->company->id}", ['contact_email' => 'hr@gmail'])->assertStatus(422)->assertJsonValidationErrors('contact_email');
        $this->patchJson("/api/coordinator/companies/{$this->company->id}", ['contact_email' => 'HR@Gmail.com'])->assertOk();
        $this->assertSame('hr@gmail.com', $this->company->fresh()->contact_email);
    }

    public function test_an_older_saved_company_email_does_not_block_other_edits(): void
    {
        $this->company->update(['contact_email' => 'old.contact@oldcompany.test']);

        $this->patchJson("/api/coordinator/companies/{$this->company->id}", ['company_name' => 'Renamed Co', 'contact_email' => 'old.contact@oldcompany.test'])->assertOk();
        $this->assertSame('Renamed Co', $this->company->fresh()->company_name);
        $this->assertSame('old.contact@oldcompany.test', $this->company->fresh()->contact_email);
    }

    public function test_updating_a_supervisor_only_checks_an_email_that_changes(): void
    {
        $sup = User::where('email', 'supervisor@internova.test')->firstOrFail();

        // The stored address (a .test domain with no mail server) is untouched, so it is not re-checked.
        $this->patchJson("/api/coordinator/supervisors/{$sup->id}", ['first_name' => 'Renamed', 'last_name' => 'Sup', 'email' => 'supervisor@internova.test', 'position' => 'Staff'])->assertOk();
        $this->assertSame('Renamed Sup', $sup->fresh()->name);
        $this->assertSame('supervisor@internova.test', $sup->fresh()->email);

        $this->patchJson("/api/coordinator/supervisors/{$sup->id}", ['first_name' => 'Renamed', 'last_name' => 'Sup', 'email' => 'sup@gmail', 'position' => 'Staff'])
            ->assertStatus(422)->assertJsonValidationErrors('email');
        $this->patchJson("/api/coordinator/supervisors/{$sup->id}", ['first_name' => 'Renamed', 'last_name' => 'Sup', 'email' => 'Real.Sup@Gmail.com', 'position' => 'Staff'])->assertOk();
        $this->assertSame('real.sup@gmail.com', $sup->fresh()->email);
    }

    public function test_a_pending_supervisor_email_is_changed_through_change_email_not_edit(): void
    {
        $this->postJson('/api/coordinator/supervisors', $this->payload())->assertOk();
        $user = User::where('email', 'nina.lopez@gmail.com')->firstOrFail();

        $this->patchJson("/api/coordinator/supervisors/{$user->id}", ['first_name' => 'Nina', 'last_name' => 'Lopez', 'email' => 'other@gmail.com'])->assertStatus(422);
        $this->assertSame('nina.lopez@gmail.com', $user->fresh()->email);

        $this->patchJson("/api/coordinator/users/{$user->id}/email", ['email' => 'nina@gmail'])->assertStatus(422)->assertJsonValidationErrors('email');
        $this->patchJson("/api/coordinator/users/{$user->id}/email", ['email' => 'nina@gmial.com'])->assertStatus(422)->assertJsonPath('errors.email.0', 'Did you mean nina@gmail.com?');
        $this->patchJson("/api/coordinator/users/{$user->id}/email", ['email' => 'Nina.New@gmail.com'])->assertOk();
        $this->assertSame('nina.new@gmail.com', $user->fresh()->email);
        Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->hasTo('nina.new@gmail.com'));
    }

    public function test_intern_creation_and_import_use_the_same_email_check(): void
    {
        $base = ['first_name' => 'Ian', 'last_name' => 'Cruz', 'course' => 'BS IT', 'company_id' => $this->company->id, 'start_date' => now()->toDateString()];

        $this->postJson('/api/coordinator/interns', $base + ['email' => 'ian@gmail.c'])->assertStatus(422)->assertJsonValidationErrors('email');
        $this->postJson('/api/coordinator/interns', $base + ['email' => 'Ian.Cruz@Gmail.com'])->assertOk();
        $this->assertDatabaseHas('users', ['email' => 'ian.cruz@gmail.com']);

        $res = $this->postJson('/api/coordinator/intern-imports/preview', ['rows' => [
            ['first_name' => 'Bad', 'last_name' => 'One', 'email' => 'bad@gmail', 'course' => 'BS IT', 'year_level' => '4th Year'],
        ]]);
        $res->assertOk();
        $this->assertStringContainsString('after the dot', json_encode($res->json()));
    }

    public function test_the_dean_coordinator_invite_rejects_incomplete_emails(): void
    {
        $dean = User::where('email', 'dean@internova.test')->firstOrFail();
        Sanctum::actingAs($dean);
        $this->postJson('/api/dean/coordinator/invite', ['name' => 'New Coord', 'email' => 'new@gmail.c'])->assertStatus(422)->assertJsonValidationErrors('email');
    }

    // ---- supervisors:default-password

    private function makeSupervisor(string $email, ?string $password, string $status = 'active'): User
    {
        $u = User::create([
            'name' => 'Sup ' . $email, 'email' => $email, 'password' => $password === null ? null : Hash::make($password),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->coordinator->school_id,
            'first_name' => 'Sup', 'last_name' => 'Test', 'status' => $status, 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $u->id, 'school_id' => $u->school_id, 'company_id' => $this->company->id]);

        return $u;
    }

    public function test_the_command_dry_run_lists_only_default_password_supervisors_and_changes_nothing(): void
    {
        $weak = $this->makeSupervisor('weak@gmail.com', 'password');
        $own = $this->makeSupervisor('own@gmail.com', 'Something-else-1');
        $pending = $this->makeSupervisor('pending@gmail.com', null, 'pending_activation');
        $intern = User::where('email', 'intern@internova.test')->firstOrFail(); // demo intern also uses "password": never listed

        $this->artisan('supervisors:default-password')
            ->expectsOutputToContain('weak@gmail.com')
            ->doesntExpectOutputToContain('own@gmail.com')
            ->doesntExpectOutputToContain('pending@gmail.com')
            ->doesntExpectOutputToContain('intern@internova.test')
            ->assertSuccessful();

        $this->assertSame('active', $weak->fresh()->status);
        $this->assertTrue(Hash::check('password', $weak->fresh()->password));
        $this->assertSame('active', $intern->fresh()->status);
        Mail::assertNothingQueued();
    }

    public function test_the_command_invite_locks_and_invites_exactly_those_and_is_idempotent(): void
    {
        $weak = $this->makeSupervisor('weak@gmail.com', 'password');
        $own = $this->makeSupervisor('own@gmail.com', 'Something-else-1');
        $intern = User::where('email', 'intern@internova.test')->firstOrFail();
        $weak->createToken('old-session');
        $demo = User::where('email', 'supervisor@internova.test')->firstOrFail(); // seeded with "password" as well

        $this->artisan('supervisors:default-password', ['--invite' => true])->assertSuccessful();

        foreach ([$weak, $demo] as $locked) {
            $locked->refresh();
            $this->assertSame('pending_activation', $locked->status);
            $this->assertNull($locked->password);
            $this->assertNull($locked->email_verified_at);
            $this->assertNotNull($locked->invitation_token);
            $this->assertSame(0, $locked->tokens()->count());
            Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->hasTo($locked->email));
        }
        $this->postJson('/api/auth/login', ['email' => 'weak@gmail.com', 'password' => 'password'])->assertStatus(401);

        $this->assertSame('active', $own->fresh()->status);
        $this->assertTrue(Hash::check('Something-else-1', $own->fresh()->password));
        $this->assertSame('active', $intern->fresh()->status);
        $this->assertTrue(Hash::check('password', $intern->fresh()->password));
        $this->assertSame(2, ActivityLog::where('action', 'Reset default supervisor password')->count());

        // Second run: nothing matches any more, so nothing is sent or changed.
        Mail::fake();
        $this->artisan('supervisors:default-password', ['--invite' => true])->expectsOutputToContain('Nothing to do')->assertSuccessful();
        Mail::assertNothingQueued();
        $this->assertSame(2, ActivityLog::where('action', 'Reset default supervisor password')->count());
    }

    public function test_the_command_never_touches_the_super_admin(): void
    {
        $admin = User::create([
            'name' => 'Real Admin', 'email' => 'francisrayla12345@gmail.com', 'password' => Hash::make('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => null, 'status' => 'active', 'email_verified_at' => now(),
        ]);

        $this->artisan('supervisors:default-password', ['--invite' => true])->assertSuccessful();

        $this->assertSame('active', $admin->fresh()->status);
        $this->assertTrue(Hash::check('password', $admin->fresh()->password));
    }
}
