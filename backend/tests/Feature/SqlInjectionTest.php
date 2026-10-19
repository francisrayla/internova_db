<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Classic SQL injection payloads sent to the login, searches, sorting and the registration form. Every query goes
 * through the query builder with bound parameters, so a payload is only ever compared as text: it never logs anyone
 * in, never widens a search, never errors (500) and never touches the tables.
 */
class SqlInjectionTest extends TestCase
{
    use RefreshDatabase;

    private const PAYLOADS = [
        "' OR '1'='1",
        "' OR 1=1 --",
        "admin' --",
        "'; DROP TABLE users; --",
        "\" OR \"\"=\"",
        "1' UNION SELECT password FROM users --",
        "%' OR '%'='",
        "') OR ('1'='1",
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function assertDatabaseUntouched(int $users): void
    {
        foreach (['users', 'schools', 'roles', 'internship_deployments', 'attendances'] as $table) {
            $this->assertTrue(Schema::hasTable($table), "{$table} still exists");
        }
        $this->assertSame($users, User::count());
    }

    public function test_login_payloads_never_sign_anyone_in(): void
    {
        $users = User::count();
        foreach (self::PAYLOADS as $p) {
            // as the email: refused by the email rule before any query
            $this->postJson('/api/auth/login', ['email' => $p, 'password' => 'x'])->assertStatus(422)->assertJsonMissingPath('token');
            // as the password of a real account: just a wrong password (or the sign-in limit after a few tries)
            $r = $this->postJson('/api/auth/login', ['email' => 'coordinator@internova.test', 'password' => $p]);
            $this->assertContains($r->status(), [401, 429]);
            $r->assertJsonMissingPath('token');
            // glued to a real email
            $r = $this->postJson('/api/auth/login', ['email' => "coordinator@internova.test{$p}", 'password' => 'password']);
            $this->assertContains($r->status(), [401, 422, 429]);
            $r->assertJsonMissingPath('token');
        }
        $this->assertDatabaseUntouched($users);
    }

    public function test_search_and_sort_payloads_match_nothing_and_never_error(): void
    {
        $users = User::count();
        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $dean = User::where('email', 'dean@internova.test')->firstOrFail();
        $supervisor = User::where('email', 'supervisor@internova.test')->firstOrFail();

        foreach (self::PAYLOADS as $p) {
            $q = urlencode($p);

            Sanctum::actingAs($coordinator);
            $r = $this->getJson("/api/coordinator/interns?page=1&per_page=15&search={$q}")->assertOk();
            $this->assertSame(0, (int) $r->json('total'), "coordinator search: {$p}");
            $this->getJson("/api/coordinator/documents?search={$q}")->assertOk();
            $this->getJson("/api/coordinator/evaluations?search={$q}")->assertOk();

            Sanctum::actingAs($dean);
            $this->getJson("/api/dean/interns?search={$q}&sort={$q}&dir={$q}")->assertOk();

            Sanctum::actingAs($supervisor);
            $this->getJson("/api/supervisor/attendance?search={$q}")->assertOk();
            $this->getJson("/api/supervisor/tasks?view=history&search={$q}")->assertOk();
        }

        // A bare wildcard is searched for literally, not as "anything".
        Sanctum::actingAs($coordinator);
        $this->assertSame(0, (int) $this->getJson('/api/coordinator/interns?page=1&per_page=15&search=' . urlencode('%'))->json('total'));
        $this->assertSame(0, (int) $this->getJson('/api/coordinator/interns?page=1&per_page=15&search=' . urlencode('_'))->json('total'));

        $this->assertDatabaseUntouched($users);
    }

    public function test_names_and_codes_refuse_symbols_but_keep_real_names(): void
    {
        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        Sanctum::actingAs($coordinator);

        foreach (["ABC'; DROP TABLE companies; --", 'Acme <b>Corp</b>', 'Acme "Corp"', 'Acme = 1', 'Acme\\Corp', 'Acme;Corp'] as $bad) {
            $this->postJson('/api/coordinator/companies', ['company_name' => $bad])
                ->assertStatus(422)->assertJsonValidationErrors('company_name');
        }
        foreach (["St. Mary's Tech, Inc.", 'Dela Cruz & Sons (Main) - Unit 4/5 #2', 'Kompanyang Pilipino: Ñiño'] as $good) {
            $this->postJson('/api/coordinator/companies', ['company_name' => $good])->assertSuccessful();
        }

        $base = ['email' => 'name.check@school.test', 'password' => 'Password#2026', 'password_confirmation' => 'Password#2026', 'accept_terms' => true, 'phone' => '09170000000'];
        $this->postJson('/api/inquiries', $base + ['school_name' => 'Good College', 'contact_person' => "Juan'; DROP TABLE users; --"])
            ->assertStatus(422)->assertJsonValidationErrors('contact_person');
        $this->postJson('/api/inquiries', $base + ['school_name' => '<script>alert(1)</script>', 'contact_person' => 'Juan Dela Cruz'])
            ->assertStatus(422)->assertJsonValidationErrors('school_name');
    }

    public function test_registration_payloads_are_refused_or_stored_as_plain_text(): void
    {
        $users = User::count();
        foreach (self::PAYLOADS as $i => $p) {
            $r = $this->postJson('/api/inquiries', [
                'school_name' => $p, 'contact_person' => $p, 'email' => "sqli{$i}@school.test",
                'password' => 'Password#2026', 'password_confirmation' => 'Password#2026', 'accept_terms' => true,
            ]);
            $this->assertNotSame(500, $r->status(), "registration: {$p}");
        }
        // Whatever was saved is exactly the text that was typed.
        foreach (\App\Models\PlanInquiry::all() as $inquiry) {
            $this->assertContains($inquiry->school_name, self::PAYLOADS);
        }
        $this->assertTrue(Schema::hasTable('users') && Schema::hasTable('plan_inquiries'));
        $this->assertGreaterThanOrEqual($users, User::count());
    }
}
