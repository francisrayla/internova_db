<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\PaymentTransaction;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Billing integrity: one open PayMongo checkout per invoice, server-verified payments, a signed
 * webhook that shares the return flow's activation, and a way forward from every billing state.
 * PayMongo is faked in full (Http::fake) - no real API is ever called.
 */
class PaymentIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'whsk_test_secret_for_phpunit';

    private School $school;
    private SubscriptionPlan $basic;
    private SubscriptionPlan $premium;

    /** @var array<string, array{status: string, paid: bool, amount: int, reference: string}> */
    private array $sessions = [];
    private int $created = 0;
    private array $expiredCalls = [];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-16 04:00:00', 'UTC'));
        config(['services.paymongo.secret_key' => 'sk_test_fake', 'services.paymongo.webhook_secret' => self::SECRET]);

        $this->basic = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true]);
        $this->premium = SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);

        $this->school = School::where('school_code', 'SCHOOL-001')->first();
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();

        $this->fakePayMongo();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** A tiny in-memory PayMongo: create, read and expire checkout sessions. Anything else fails the test. */
    private function fakePayMongo(): void
    {
        Http::preventStrayRequests();
        Http::fake(function (HttpRequest $request) {
            $url = $request->url();

            if (preg_match('#/checkout_sessions$#', $url) && $request->method() === 'POST') {
                $id = 'cs_test_' . (++$this->created);
                $line = $request['data']['attributes']['line_items'][0];
                $this->sessions[$id] = ['status' => 'active', 'paid' => false, 'amount' => $line['amount'], 'reference' => $request['data']['attributes']['reference_number']];

                return Http::response(['data' => $this->sessionResource($id)]);
            }

            if (preg_match('#/checkout_sessions/(cs_[a-z0-9_]+)/expire$#', $url, $m)) {
                $this->expiredCalls[] = $m[1];
                $this->sessions[$m[1]]['status'] = 'expired';

                return Http::response(['data' => $this->sessionResource($m[1])]);
            }

            if (preg_match('#/checkout_sessions/(cs_[a-z0-9_]+)$#', $url, $m) && $request->method() === 'GET') {
                return isset($this->sessions[$m[1]])
                    ? Http::response(['data' => $this->sessionResource($m[1])])
                    : Http::response(['errors' => []], 404);
            }

            return Http::response(['errors' => [['detail' => 'unexpected call']]], 500);
        });
    }

    private function sessionResource(string $id): array
    {
        $s = $this->sessions[$id];

        return [
            'id' => $id,
            'type' => 'checkout_session',
            'attributes' => [
                'status' => $s['status'],
                'checkout_url' => "https://pm.test/{$id}",
                'reference_number' => $s['reference'],
                'payment_intent' => ['attributes' => ['status' => $s['paid'] ? 'succeeded' : 'awaiting_payment_method', 'amount' => $s['amount']]],
                'payments' => $s['paid'] ? [['attributes' => ['status' => 'paid', 'amount' => $s['amount']]]] : [],
            ],
        ];
    }

    private function pay(string $id, ?int $amount = null): void
    {
        $this->sessions[$id]['paid'] = true;
        if ($amount !== null) {
            $this->sessions[$id]['amount'] = $amount;
        }
    }

    private function createdSessionCount(): int
    {
        return count(Http::recorded(fn (HttpRequest $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/checkout_sessions')));
    }

    private function dean(): User
    {
        return User::where('email', 'dean@internova.test')->first();
    }

    private function superAdmin(): User
    {
        return User::where('email', 'superadmin@internova.test')->first();
    }

    private function url(string $path): string
    {
        return "/api/dean/schools/{$this->school->id}/{$path}";
    }

    /** A Basic monthly offer the Dean already accepted (status accepted, no dates yet). */
    private function acceptedOffer(float $amount = 1500): SchoolSubscription
    {
        $this->school->update(['status' => 'accepted']);

        return $this->school->subscriptions()->create([
            'plan_id' => $this->basic->id, 'status' => 'accepted', 'billing_period' => 'monthly',
            'list_price' => $amount, 'discount_amount' => 0, 'amount' => $amount,
            'offer_sent_at' => now(), 'accepted_at' => now(),
        ]);
    }

    /** A paid Basic monthly term that ended on Oct 31. */
    private function activeTerm(string $end = '2026-10-31'): SchoolSubscription
    {
        $this->school->update(['status' => 'active']);
        $sub = $this->school->subscriptions()->create([
            'plan_id' => $this->basic->id, 'status' => 'active', 'billing_period' => 'monthly',
            'list_price' => 1500, 'discount_amount' => 0, 'amount' => 1500,
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'paid_at' => now()->subDays(15),
            'start_date' => '2026-10-01', 'end_date' => $end,
        ]);
        PaymentTransaction::create([
            'school_id' => $this->school->id, 'subscription_id' => $sub->id, 'payment_type' => 'initial',
            'new_plan_id' => $this->basic->id, 'payment_method' => 'gcash', 'amount' => 1500, 'status' => 'paid', 'paid_at' => now()->subDays(15),
        ]);

        return $sub;
    }

    private function sign(string $body, bool $live = false, ?string $secret = null): string
    {
        $t = (string) time();
        $sig = hash_hmac('sha256', $t . '.' . $body, $secret ?? self::SECRET);

        return $live ? "t={$t},te=,li={$sig}" : "t={$t},te={$sig},li=";
    }

    private function webhook(string $type, array $resource, ?string $signature = null, bool $live = false): \Illuminate\Testing\TestResponse
    {
        $body = json_encode(['data' => ['id' => 'evt_1', 'type' => 'event', 'attributes' => ['type' => $type, 'livemode' => $live, 'data' => $resource]]]);

        return $this->call('POST', '/api/webhooks/paymongo', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_PAYMONGO_SIGNATURE' => $signature ?? $this->sign($body, $live),
        ], $body);
    }

    private function paidEvent(string $sessionId): \Illuminate\Testing\TestResponse
    {
        return $this->webhook('checkout_session.payment.paid', $this->sessionResource($sessionId));
    }

    // ---- 1. checkout idempotency -------------------------------------------------------------

    public function test_second_checkout_click_reuses_the_open_session_instead_of_a_second_charge(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());

        $first = $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $second = $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();

        $this->assertSame($first->json('checkout_url'), $second->json('checkout_url'));
        $this->assertSame(1, $this->createdSessionCount());
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $offer->id)->count());
        $this->assertSame('pending', PaymentTransaction::first()->status);
    }

    public function test_switching_method_closes_the_old_session_and_leaves_one_open_payment(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->postJson($this->url('checkout'), ['payment_method' => 'card'])->assertOk()->assertJsonPath('checkout_url', 'https://pm.test/cs_test_2');

        $this->assertSame(['cs_test_1'], $this->expiredCalls);
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'pending')->count());
        $this->assertSame('cancelled', PaymentTransaction::where('gateway_reference', 'cs_test_1')->value('status'));
        $this->assertSame('cs_test_2', $offer->fresh()->payment_reference);
    }

    public function test_choosing_bank_transfer_after_card_closes_the_card_session_and_bank_twice_keeps_one_reference(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('checkout'), ['payment_method' => 'card'])->assertOk();
        $bank1 = $this->postJson($this->url('checkout'), ['payment_method' => 'bank_transfer'])->assertOk();
        $bank2 = $this->postJson($this->url('checkout'), ['payment_method' => 'bank_transfer'])->assertOk();

        $this->assertSame(['cs_test_1'], $this->expiredCalls);
        $this->assertSame($bank1->json('reference'), $bank2->json('reference'));
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'pending')->count());
    }

    public function test_dean_who_started_bank_transfer_can_still_switch_to_card_until_proof_is_sent(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('checkout'), ['payment_method' => 'bank_transfer'])->assertOk();
        $this->assertSame('pending_payment', $offer->fresh()->status);

        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk()->assertJsonPath('method', 'gcash');
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'pending')->count());

        // Once proof is under review the method is locked.
        $offer->update(['payment_method' => 'bank_transfer', 'payment_status' => 'pending_verification']);
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertStatus(422);
    }

    public function test_checkout_for_a_session_that_is_already_paid_activates_instead_of_charging_again(): void
    {
        $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1');

        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk()->assertJsonPath('paid', true);

        $this->assertSame(1, $this->createdSessionCount());
        $this->assertSame('active', $this->school->latestBillableSubscription()->status);
    }

    // ---- 1. server-side verification, no double activation --------------------------------------

    public function test_verify_checks_paymongo_and_ignores_whatever_the_browser_claims(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();

        // The browser says "paid" in every way it can; PayMongo says it is not.
        $this->postJson($this->url('verify-checkout') . '?paid=1&status=succeeded', ['paid' => true, 'status' => 'succeeded', 'payment_status' => 'paid'])
            ->assertStatus(422);

        $this->assertSame('accepted', $offer->fresh()->status);
        $this->assertNull($offer->fresh()->start_date);
        $this->assertSame('pending', PaymentTransaction::first()->status);
    }

    public function test_verify_activates_once_and_repeating_it_does_not_extend_or_duplicate(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1');

        $this->postJson($this->url('verify-checkout'))->assertOk()->assertJsonMissingPath('already_active');
        $end = $offer->fresh()->end_date->toDateString();
        $paidAt = PaymentTransaction::first()->paid_at;

        Carbon::setTestNow(now()->addDays(3));
        $this->postJson($this->url('verify-checkout'))->assertOk()->assertJsonPath('already_active', true);
        $this->paidEvent('cs_test_1')->assertOk();

        $this->assertSame($end, $offer->fresh()->end_date->toDateString());
        $this->assertSame(1, PaymentTransaction::count());
        $this->assertSame('paid', PaymentTransaction::first()->status);
        $this->assertEquals($paidAt, PaymentTransaction::first()->paid_at);
        $this->assertSame(1, ActivityLog::where('action', 'like', 'Paid via%')->count());
    }

    public function test_verify_refuses_a_session_paid_for_a_different_amount(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1', 100); // 1 peso instead of 1,500

        $this->postJson($this->url('verify-checkout'))->assertStatus(422);

        $this->assertSame('accepted', $offer->fresh()->status);
        $this->assertTrue(Notification::where('type', 'payment_mismatch')->exists());
    }

    // ---- 1. webhook ----------------------------------------------------------------------------

    public function test_webhook_rejects_bad_signatures_and_an_unconfigured_secret(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1');
        $resource = $this->sessionResource('cs_test_1');

        $this->webhook('checkout_session.payment.paid', $resource, 't=123,te=deadbeef,li=')->assertStatus(401);
        $this->webhook('checkout_session.payment.paid', $resource, '')->assertStatus(401);
        // Signed with another secret.
        $body = json_encode(['data' => ['attributes' => ['type' => 'checkout_session.payment.paid', 'livemode' => false, 'data' => $resource]]]);
        $this->call('POST', '/api/webhooks/paymongo', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => $this->sign($body, false, 'someone_elses_secret')], $body)->assertStatus(401);
        // A test-mode signature does not pass for a live event.
        $liveBody = json_encode(['data' => ['attributes' => ['type' => 'checkout_session.payment.paid', 'livemode' => true, 'data' => $resource]]]);
        $this->call('POST', '/api/webhooks/paymongo', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => $this->sign($liveBody, false)], $liveBody)->assertStatus(401);
        $this->assertSame('accepted', $offer->fresh()->status);

        config(['services.paymongo.webhook_secret' => null]);
        $this->paidEvent('cs_test_1')->assertStatus(503);
        $this->assertSame('accepted', $offer->fresh()->status);
    }

    public function test_signed_paid_webhook_activates_without_login_then_a_replay_changes_nothing(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1');

        // The webhook is a plain unauthenticated call.
        $this->app['auth']->forgetGuards();
        $this->paidEvent('cs_test_1')->assertOk();

        $offer->refresh();
        $this->assertSame('active', $offer->status);
        $this->assertSame('paid', $offer->payment_status);
        $this->assertSame('2026-11-16', $offer->end_date->toDateString());
        $this->assertSame('active', $this->school->fresh()->status);
        $this->assertSame('paid', PaymentTransaction::first()->status);
        $this->assertTrue(Notification::where('type', 'payment_confirmed')->where('audience_role', 'dean')->exists());

        Carbon::setTestNow(now()->addDays(5));
        $this->paidEvent('cs_test_1')->assertOk();
        $this->paidEvent('cs_test_1')->assertOk();

        $this->assertSame('2026-11-16', $offer->fresh()->end_date->toDateString());
        $this->assertSame(1, PaymentTransaction::count());
        $this->assertSame(1, ActivityLog::where('action', 'like', 'Paid via%')->count());
    }

    public function test_webhook_for_a_paid_upgrade_switches_the_plan_and_supersedes_the_old_one(): void
    {
        $current = $this->activeTerm();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('upgrade-plan'), ['plan_name' => 'Premium', 'billing_period' => 'monthly', 'payment_method' => 'gcash'])->assertOk();
        $pending = $this->school->subscriptions()->where('status', 'pending_payment')->first();
        $this->pay('cs_test_1');

        $this->paidEvent('cs_test_1')->assertOk();

        $this->assertSame('active', $pending->fresh()->status);
        $this->assertSame('superseded', $current->fresh()->status);
        $this->assertSame('2026-10-31', $pending->fresh()->end_date->toDateString()); // upgrade keeps the cycle
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $pending->id)->count());
    }

    public function test_webhook_failed_and_expired_events_close_the_attempt_and_a_later_payment_still_works(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();

        $this->webhook('payment.failed', ['id' => 'pay_1', 'type' => 'payment', 'attributes' => ['external_reference_number' => "SUB-{$offer->id}"]])->assertOk();
        $this->assertSame('failed', PaymentTransaction::first()->status);
        $this->assertTrue(Notification::where('type', 'payment_failed')->exists());
        $this->assertSame('accepted', $offer->fresh()->status);

        // The same open session is still payable: checkout reuses it instead of opening a second one.
        $again = $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->assertSame('https://pm.test/cs_test_1', $again->json('checkout_url'));
        $this->assertSame(1, $this->createdSessionCount());

        $this->pay('cs_test_1');
        $this->paidEvent('cs_test_1')->assertOk();
        $this->assertSame('active', $offer->fresh()->status);
        $this->assertSame(1, PaymentTransaction::where('status', 'paid')->count());
    }

    public function test_webhook_expired_event_marks_the_attempt_expired(): void
    {
        $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->sessions['cs_test_1']['status'] = 'expired';

        $this->webhook('checkout_session.expired', $this->sessionResource('cs_test_1'))->assertOk();
        $this->assertSame('expired', PaymentTransaction::first()->status);

        // Next click opens a fresh session because the old one is dead.
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk()->assertJsonPath('checkout_url', 'https://pm.test/cs_test_2');
    }

    public function test_payment_for_a_cancelled_upgrade_is_not_activated_but_flagged_for_review(): void
    {
        $this->activeTerm();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('upgrade-plan'), ['plan_name' => 'Premium', 'billing_period' => 'monthly', 'payment_method' => 'gcash'])->assertOk();
        $pending = $this->school->subscriptions()->where('status', 'pending_payment')->first();

        // Dean cancels: the PayMongo session is closed so it cannot be paid later.
        $this->postJson($this->url('cancel-pending-upgrade'))->assertOk();
        $this->assertSame(['cs_test_1'], $this->expiredCalls);
        $this->assertSame('cancelled', $pending->fresh()->status);

        // A payment that still slipped through is kept on record and flagged, never activated.
        $this->pay('cs_test_1');
        $this->paidEvent('cs_test_1')->assertOk();
        $this->assertSame('cancelled', $pending->fresh()->status);
        $this->assertTrue(Notification::where('type', 'payment_needs_review')->exists());
    }

    public function test_cancelling_an_upgrade_that_was_already_paid_activates_it_instead(): void
    {
        $current = $this->activeTerm();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('upgrade-plan'), ['plan_name' => 'Premium', 'billing_period' => 'monthly', 'payment_method' => 'gcash'])->assertOk();
        $pending = $this->school->subscriptions()->where('status', 'pending_payment')->first();
        $this->pay('cs_test_1');

        $this->postJson($this->url('cancel-pending-upgrade'))->assertStatus(422);

        $this->assertSame('active', $pending->fresh()->status);
        $this->assertSame('superseded', $current->fresh()->status);
    }

    // ---- 2. expired subscription: renew -> pay -> active --------------------------------------------

    public function test_expired_subscription_can_be_renewed_paid_and_reactivated(): void
    {
        $old = $this->activeTerm('2026-10-31');
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        Sanctum::actingAs($this->dean());

        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->assertOk()->json('user');
        $this->assertSame('expired', $session['subscription_status']);

        // The old dead end: neither accept-offer nor checkout has anything to work with.
        $this->postJson($this->url('accept-offer'))->assertStatus(422);
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertStatus(422);

        $this->postJson($this->url('renew'))->assertOk()->assertJsonPath('success', true);

        $old->refresh();
        $this->assertSame('expired', $old->status);
        $renewal = $this->school->subscriptions()->where('status', 'accepted')->first();
        $this->assertNotNull($renewal);
        $this->assertSame($this->basic->id, $renewal->plan_id);
        $this->assertEquals(1500, $renewal->amount);
        $this->assertNull($renewal->start_date);
        $this->assertSame('accepted', $this->school->fresh()->status);

        $session = $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user');
        $this->assertSame('accepted', $session['subscription_status']);
        $this->assertEquals(1500, $session['subscription_breakdown']['total']);

        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->assertSame('renewal', PaymentTransaction::where('subscription_id', $renewal->id)->value('payment_type'));
        $this->pay('cs_test_1');
        $this->postJson($this->url('verify-checkout'))->assertOk();

        $renewal->refresh();
        $this->assertSame('active', $renewal->status);
        $this->assertSame('2026-11-05', $renewal->start_date->toDateString());
        $this->assertSame('2026-12-05', $renewal->end_date->toDateString());
        $this->assertSame('active', $this->school->fresh()->status);
        $this->assertSame('active', $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user.subscription_status'));
        // Money collected: the first term plus the renewal, once each.
        $this->assertSame(2, PaymentTransaction::where('status', 'paid')->count());
    }

    public function test_renewal_by_bank_transfer_is_verified_by_the_super_admin(): void
    {
        $this->activeTerm('2026-10-31');
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('renew'), ['plan_name' => 'Premium', 'billing_period' => 'yearly'])->assertOk();
        $renewal = $this->school->subscriptions()->where('status', 'accepted')->first();
        $this->assertEquals(35000, $renewal->amount); // different plan: published price

        $this->postJson($this->url('checkout'), ['payment_method' => 'bank_transfer'])->assertOk();
        \Illuminate\Support\Facades\Storage::fake('public');
        $this->post($this->url('upload-proof'), ['proof' => \Illuminate\Http\UploadedFile::fake()->image('proof.png')], ['Accept' => 'application/json'])->assertOk();

        Sanctum::actingAs($this->superAdmin());
        $this->postJson("/api/superadmin/schools/{$this->school->id}/verify-payment")->assertOk();
        $this->postJson("/api/superadmin/schools/{$this->school->id}/verify-payment")->assertStatus(422);

        $renewal->refresh();
        $this->assertSame('active', $renewal->status);
        $this->assertSame('2027-11-05', $renewal->end_date->toDateString());
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $renewal->id)->count());
        $this->assertSame('paid', PaymentTransaction::where('subscription_id', $renewal->id)->value('status'));
    }

    public function test_renew_is_refused_when_nothing_expired_or_the_school_is_paused(): void
    {
        $this->activeTerm('2026-10-31');
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('renew'))->assertStatus(422); // still running on Oct 16

        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        $this->school->update(['is_suspended' => true]);
        $this->postJson($this->url('renew'))->assertStatus(422);
    }

    public function test_renewing_twice_creates_a_single_renewal(): void
    {
        $this->activeTerm('2026-10-31');
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('renew'))->assertOk();
        $this->postJson($this->url('renew'))->assertStatus(422);

        $this->assertSame(1, $this->school->subscriptions()->where('status', 'accepted')->count());
    }

    public function test_renew_pays_the_approved_plan_change_that_was_already_waiting(): void
    {
        $old = $this->activeTerm('2026-10-31');
        $approved = $this->school->subscriptions()->create([
            'plan_id' => $this->premium->id, 'status' => 'accepted', 'billing_period' => 'monthly',
            'list_price' => 3500, 'discount_amount' => 500, 'amount' => 3000, 'agreement_note' => 'Partner',
            'offer_sent_at' => now(), 'accepted_at' => now(),
        ]);
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        Sanctum::actingAs($this->dean());

        $this->postJson($this->url('renew'))->assertOk();

        $this->assertSame('expired', $old->fresh()->status);
        $this->assertSame(1, $this->school->subscriptions()->where('status', 'accepted')->count());
        $this->assertSame($approved->id, $this->school->latestBillableSubscription()->id);
        $this->assertEquals(3000, $this->school->latestBillableSubscription()->amount);
    }

    public function test_an_expired_offer_can_ask_the_super_admin_for_a_new_one_and_proof_under_review_never_expires(): void
    {
        $offer = $this->acceptedOffer();
        $offer->update(['offer_expires_at' => now()->subDay()]);
        Sanctum::actingAs($this->dean());

        $this->assertSame('offer_expired', $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user.subscription_status'));
        $this->postJson($this->url('request-new-offer'))->assertOk();
        $this->assertTrue(Notification::where('type', 'new_offer_requested')->exists());

        // ...and the Super Admin's resend brings the Dean back to a valid offer.
        Sanctum::actingAs($this->superAdmin());
        $this->postJson("/api/superadmin/schools/{$this->school->id}/resend-offer")->assertOk();
        Sanctum::actingAs($this->dean());
        $this->assertSame('awaiting_acceptance', $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user.subscription_status'));

        // An offer past its window but with a proof already submitted is not "expired".
        $offer->refresh()->update(['status' => 'pending_payment', 'payment_method' => 'bank_transfer', 'payment_status' => 'pending_verification', 'offer_expires_at' => now()->subDay()]);
        $this->assertSame('pending_payment', $this->getJson('/api/auth/session/' . $this->dean()->id)->json('user.subscription_status'));
        $this->postJson($this->url('request-new-offer'))->assertStatus(422);
    }

    // ---- 5. manual override --------------------------------------------------------------------------

    public function test_manual_payment_confirmation_is_audited_and_cannot_be_applied_twice(): void
    {
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk(); // an open PayMongo session exists

        Sanctum::actingAs($this->superAdmin());
        $this->postJson("/api/superadmin/schools/{$this->school->id}/confirm-payment", ['note' => 'Cash at the office'])->assertOk();
        $this->postJson("/api/superadmin/schools/{$this->school->id}/confirm-payment")->assertStatus(422);

        $this->assertSame('active', $offer->fresh()->status);
        $this->assertSame(['cs_test_1'], $this->expiredCalls); // the school can no longer pay that session
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'paid')->count());
        $this->assertSame(0, PaymentTransaction::where('subscription_id', $offer->id)->where('status', 'pending')->count());

        $log = ActivityLog::where('action', 'Confirmed payment (manual override)')->first();
        $this->assertNotNull($log);
        $this->assertStringContainsString('superadmin@internova.test', $log->description);
        $this->assertStringContainsString('Cash at the office', $log->description);
    }

    public function test_confirming_payment_for_an_expired_school_explains_the_renewal_step(): void
    {
        $this->activeTerm('2026-10-31');
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));
        Sanctum::actingAs($this->superAdmin());

        $this->postJson("/api/superadmin/schools/{$this->school->id}/confirm-payment")
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'renewal'));
    }

    public function test_activating_a_row_whose_dates_already_passed_starts_a_fresh_term(): void
    {
        $sub = $this->activeTerm('2026-10-05'); // ended Oct 5
        $sub->update(['status' => 'expired']);
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));

        $sub->activate();

        $sub->refresh();
        $this->assertSame('2026-11-05', $sub->start_date->toDateString());
        $this->assertSame('2026-12-05', $sub->end_date->toDateString());
    }

    public function test_concurrent_activation_paths_leave_exactly_one_paid_transaction(): void
    {
        // Return flow, webhook and an admin verification all hit the same invoice.
        $offer = $this->acceptedOffer();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();
        $this->pay('cs_test_1');

        $this->paidEvent('cs_test_1')->assertOk();
        $this->postJson($this->url('verify-checkout'))->assertOk()->assertJsonPath('already_active', true);
        $outcome = \App\Services\PaymentActivation::activate($offer->fresh(), 'cs_test_1');

        $this->assertSame(\App\Services\PaymentActivation::ALREADY_ACTIVE, $outcome['result']);
        $this->assertSame(1, PaymentTransaction::where('status', 'paid')->count());
        $this->assertSame(1, PaymentTransaction::count());
        $this->assertSame(1, SchoolSubscription::where('status', 'active')->count());
    }

    // ---- 5. plan changes ------------------------------------------------------------------------------

    private function approveChange(string $plan, string $period, array $body = []): \Illuminate\Testing\TestResponse
    {
        $req = \App\Models\PlanChangeRequest::create([
            'school_id' => $this->school->id, 'requested_plan' => $plan, 'requested_billing_period' => $period, 'status' => 'pending',
        ]);
        Sanctum::actingAs($this->superAdmin());

        return $this->postJson("/api/superadmin/plan-change-requests/{$req->id}/approve", $body);
    }

    public function test_approving_a_second_change_closes_the_open_checkout_of_the_first(): void
    {
        $this->activeTerm();
        $this->approveChange('Premium', 'monthly', ['discount_amount' => 500, 'agreement_note' => 'Partner'])->assertOk();
        $first = $this->school->subscriptions()->where('status', 'accepted')->first();

        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('checkout'), ['payment_method' => 'gcash'])->assertOk();

        $this->approveChange('Premium', 'yearly')->assertOk();

        $this->assertSame('cancelled', $first->fresh()->status);
        $this->assertSame(['cs_test_1'], $this->expiredCalls);
        $this->assertSame('cancelled', PaymentTransaction::where('gateway_reference', 'cs_test_1')->value('status'));
        $this->assertSame(1, $this->school->subscriptions()->where('status', 'accepted')->count());
    }

    public function test_reviewing_the_same_plan_change_twice_creates_one_offer(): void
    {
        $this->activeTerm();
        $req = \App\Models\PlanChangeRequest::create([
            'school_id' => $this->school->id, 'requested_plan' => 'Premium', 'requested_billing_period' => 'monthly', 'status' => 'pending',
        ]);
        Sanctum::actingAs($this->superAdmin());

        $this->postJson("/api/superadmin/plan-change-requests/{$req->id}/approve")->assertOk();
        $this->postJson("/api/superadmin/plan-change-requests/{$req->id}/approve")->assertStatus(422);

        $this->assertSame(1, $this->school->subscriptions()->where('status', 'accepted')->count());
    }

    public function test_handing_over_to_a_scheduled_switch_happens_once(): void
    {
        $old = $this->activeTerm('2026-10-31');
        $scheduled = $this->school->subscriptions()->create([
            'plan_id' => $this->premium->id, 'status' => 'scheduled', 'billing_period' => 'monthly',
            'list_price' => 3500, 'discount_amount' => 0, 'amount' => 3500,
            'start_date' => '2026-11-01', 'end_date' => '2026-12-01', 'offer_sent_at' => now(), 'accepted_at' => now(),
        ]);
        Carbon::setTestNow(Carbon::parse('2026-11-05 04:00:00', 'UTC'));

        $this->school->currentSubscription();
        $this->school->fresh()->currentSubscription();
        $this->school->fresh()->currentSubscription();

        $this->assertSame('expired', $old->fresh()->status);
        $this->assertSame('accepted', $scheduled->fresh()->status);
        $this->assertSame(1, Notification::where('type', 'plan_switch_due')->count());
    }

    public function test_cancelling_still_works_when_paymongo_cannot_be_reached_but_switching_method_waits(): void
    {
        $this->activeTerm();
        Sanctum::actingAs($this->dean());
        $this->postJson($this->url('upgrade-plan'), ['plan_name' => 'Premium', 'billing_period' => 'monthly', 'payment_method' => 'gcash'])->assertOk();
        unset($this->sessions['cs_test_1']); // PayMongo now answers 404 for it

        // Changing the method must not open a second session while the first one is unknown...
        $this->postJson($this->url('checkout'), ['payment_method' => 'card'])->assertStatus(502);
        $this->assertSame(1, $this->createdSessionCount());

        // ...but backing out is never blocked by PayMongo being down.
        $this->postJson($this->url('cancel-pending-upgrade'))->assertOk();
        $this->assertSame(0, $this->school->subscriptions()->where('status', 'pending_payment')->count());
    }
}
