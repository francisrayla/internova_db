<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\TestCase;

/**
 * No screen may hand out password hashes, session / invitation / reset tokens or API keys,
 * whoever asks: every parameter-less GET of every role is scanned.
 */
class SensitiveFieldExposureTest extends TestCase
{
    use RefreshDatabase;

    private const FORBIDDEN_KEYS = ['password', 'remember_token', 'invitation_token', 'reset_token', 'api_key', 'apikey', 'secret', 'access_token', 'plainTextToken', 'two_factor'];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function keysIn(mixed $data, array &$found, string $path = ''): void
    {
        if (!is_array($data)) {
            return;
        }
        foreach ($data as $key => $value) {
            if (is_string($key)) {
                $lower = strtolower($key);
                foreach (self::FORBIDDEN_KEYS as $bad) {
                    if (str_contains($lower, strtolower($bad))) {
                        $found[] = "$path.$key";
                    }
                }
            }
            $this->keysIn($value, $found, "$path.$key");
        }
    }

    public function test_no_listing_exposes_secrets(): void
    {
        $actors = [
            'super_admin' => User::where('email', 'superadmin@internova.test')->firstOrFail(),
            'dean' => User::where('email', 'dean@internova.test')->firstOrFail(),
            'coordinator' => User::where('email', 'coordinator@internova.test')->firstOrFail(),
            'supervisor' => User::where('email', 'supervisor@internova.test')->firstOrFail(),
            'intern' => User::where('email', 'intern@internova.test')->firstOrFail(),
        ];
        $prefix = ['super_admin' => 'api/superadmin/', 'dean' => 'api/dean/', 'coordinator' => 'api/coordinator/', 'supervisor' => 'api/supervisor/', 'intern' => 'api/intern/'];

        $leaks = [];
        $checked = 0;
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (!in_array('GET', $route->methods(), true) || str_contains($uri, '{') || !str_starts_with($uri, 'api/')) {
                continue;
            }
            foreach ($actors as $role => $user) {
                $shared = str_starts_with($uri, 'api/notifications') || str_starts_with($uri, 'api/messages') || str_starts_with($uri, 'api/auth');
                if (!$shared && !str_starts_with($uri, $prefix[$role])) {
                    continue;
                }
                Sanctum::actingAs($user);
                $res = $this->getJson('/'.$uri);
                $checked++;
                if ($res->baseResponse instanceof BinaryFileResponse || $res->baseResponse instanceof StreamedResponse) {
                    continue; // a file download, nothing to scan
                }
                if ($res->getStatusCode() >= 500) {
                    $this->fail("GET /$uri as $role crashed with {$res->getStatusCode()}");
                }
                $json = json_decode($res->getContent(), true);
                $found = [];
                $this->keysIn($json, $found);
                foreach ($found as $where) {
                    $leaks[] = "$role GET /$uri $where";
                }
                if (preg_match('/\$2y\$\d{2}\$/', $res->getContent())) {
                    $leaks[] = "$role GET /$uri contains a bcrypt hash";
                }
            }
        }

        $this->assertGreaterThan(50, $checked);
        $this->assertSame([], $leaks, implode("\n", $leaks));
    }

    public function test_only_billing_roles_get_money_details_in_their_session(): void
    {
        \App\Models\SchoolSubscription::query()->update(['amount' => 4999, 'payment_reference' => 'REF-123', 'payment_method' => 'bank_transfer']);

        foreach (['coordinator@internova.test', 'supervisor@internova.test', 'intern@internova.test'] as $email) {
            $user = $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'password'])->assertOk()->json('user');
            foreach (['subscription_amount', 'payment_reference', 'payment_method', 'subscription_breakdown', 'pending_upgrade', 'approved_change', 'scheduled_switch'] as $key) {
                $this->assertNull($user[$key], "$email must not receive $key");
            }
            $this->assertNotNull($user['subscription_plan'], 'the plan itself is still needed to gate features');
            $this->assertIsArray($user['plan_features']);
        }

        $dean = $this->postJson('/api/auth/login', ['email' => 'dean@internova.test', 'password' => 'password'])->assertOk()->json('user');
        $this->assertSame('REF-123', $dean['payment_reference']);
    }

    public function test_login_and_session_payloads_hold_no_secrets(): void
    {
        $res = $this->postJson('/api/auth/login', ['email' => 'coordinator@internova.test', 'password' => 'password'])->assertOk();
        $user = $res->json('user');
        $found = [];
        $this->keysIn($user, $found);
        $this->assertSame([], $found);
        $this->assertArrayHasKey('token', $res->json());

        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $array = $coordinator->toArray();
        $this->assertArrayNotHasKey('password', $array);
        $this->assertArrayNotHasKey('remember_token', $array);
        $this->assertArrayNotHasKey('invitation_token', $array, 'a serialised user must never carry the invitation token');
    }
}
