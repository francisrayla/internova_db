<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\InternshipDeployment;
use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Fixes found while QA-ing the Dean role (2026-10-10). */
class DeanQaFixesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function dean(): User
    {
        return User::where('email', 'dean@internova.test')->first();
    }

    public function test_a_non_numeric_record_id_is_a_404_not_a_server_error(): void
    {
        Sanctum::actingAs($this->dean());

        $this->getJson('/api/dean/interns/abc')->assertNotFound();
        $this->getJson('/api/dean/interns/abc/narrative-report')->assertNotFound();
        $this->postJson('/api/dean/coordinator/feedback/abc/resolve')->assertNotFound();
        // A real but unknown id keeps answering 404 too.
        $this->getJson('/api/dean/interns/999999')->assertNotFound();
    }

    public function test_a_proof_already_under_review_cannot_be_replaced(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();
        $plan = SubscriptionPlan::firstOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);
        $sub = $school->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => 'pending_payment', 'billing_period' => 'monthly', 'list_price' => 3500, 'amount' => 3500,
            'payment_method' => 'bank_transfer', 'payment_status' => 'pending', 'payment_reference' => 'INTERNOVA-TEST0001',
            'offer_sent_at' => now(), 'accepted_at' => now(),
        ]);
        Sanctum::actingAs($this->dean());

        $url = "/api/dean/schools/{$school->id}/upload-proof";
        $this->post($url, ['proof' => UploadedFile::fake()->image('first.png')], ['Accept' => 'application/json'])->assertOk();
        $firstPath = $sub->fresh()->proof_of_payment_path;
        $this->assertNotNull($firstPath);

        $this->post($url, ['proof' => UploadedFile::fake()->image('second.png')], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('success', false);
        $this->assertSame($firstPath, $sub->fresh()->proof_of_payment_path);
        $this->assertCount(1, Storage::disk('public')->allFiles("payment_proofs/{$school->id}"));
    }

    public function test_only_one_plan_change_request_can_wait_at_a_time(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        Sanctum::actingAs($this->dean());
        $body = ['plan_name' => 'Basic', 'billing_period' => 'monthly', 'note' => 'discount please'];

        $this->postJson("/api/dean/schools/{$school->id}/request-plan-change", $body)->assertOk();
        $this->postJson("/api/dean/schools/{$school->id}/request-plan-change", $body)->assertStatus(422);
        $this->assertSame(1, PlanChangeRequest::where('school_id', $school->id)->where('status', 'pending')->count());

        // Once the Super Admin has answered, a new request is welcome again.
        PlanChangeRequest::where('school_id', $school->id)->update(['status' => 'rejected']);
        $this->postJson("/api/dean/schools/{$school->id}/request-plan-change", $body)->assertOk();
    }

    public function test_intern_detail_says_how_many_rows_exist_when_the_lists_are_capped(): void
    {
        $deployment = InternshipDeployment::where('intern_id', User::where('email', 'intern@internova.test')->value('id'))->first();
        for ($i = 0; $i < 33; $i++) {
            Attendance::create([
                'deployment_id' => $deployment->id, 'attendance_date' => now()->subDays($i + 1)->toDateString(), 'session' => 'full',
                'clock_in' => now()->subDays($i + 1)->setTime(1, 0), 'clock_out' => now()->subDays($i + 1)->setTime(9, 0), 'status' => 'approved',
            ]);
        }
        Sanctum::actingAs($this->dean());

        $res = $this->getJson("/api/dean/interns/{$deployment->id}")->assertOk();
        $this->assertCount(31, $res->json('attendance'));
        $this->assertSame(33, $res->json('totals.attendance'));
        $this->assertArrayHasKey('activities', $res->json('totals'));
        $this->assertArrayHasKey('tasks', $res->json('totals'));
    }

    public function test_a_table_sort_orders_the_whole_list_across_pages(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        $company = \App\Models\Company::where('school_id', $school->id)->first();
        $coordinator = User::where('email', 'coordinator@internova.test')->first();
        foreach (['Zed Zulu', 'Amy Alpha', 'Mike Mid', 'Bea Beta', 'Carl Gamma'] as $i => $full) {
            [$first, $last] = explode(' ', $full);
            $intern = User::create([
                'name' => $full, 'email' => "sort{$i}@internova.test", 'password' => bcrypt('password'), 'status' => 'active',
                'role_id' => \App\Services\SchoolStaff::roleId('intern'), 'school_id' => $school->id,
                'first_name' => $first, 'last_name' => $last, 'email_verified_at' => now(),
            ]);
            \App\Models\InternProfile::create(['user_id' => $intern->id, 'school_id' => $school->id, 'student_number' => "S{$i}", 'course' => 'BS IT', 'year_level' => '4th Year', 'required_hours' => 480]);
            InternshipDeployment::create([
                'intern_id' => $intern->id, 'company_id' => $company->id, 'school_id' => $school->id, 'coordinator_id' => $coordinator->id,
                'start_date' => now()->subDays(20)->toDateString(), 'end_date' => now()->addDays(60)->toDateString(), 'required_hours' => 480, 'status' => 'active',
            ]);
        }
        Sanctum::actingAs($this->dean());

        $names = function (string $query): array {
            $all = [];
            for ($page = 1; $page <= 10; $page++) {
                $res = $this->getJson("/api/dean/interns?per_page=2&page={$page}&{$query}")->assertOk();
                $all = [...$all, ...collect($res->json('interns'))->pluck('intern_name')->all()];
                if (!$res->json('has_more')) {
                    break;
                }
            }

            return $all;
        };

        $unsorted = $names('');
        $this->assertGreaterThan(2, count($unsorted), 'the demo school needs more than one page of interns for this test');

        $asc = $names('sort=name&dir=asc');
        $expected = collect($unsorted)->map(fn ($n) => mb_strtolower($n))->sort()->values()->all();
        $this->assertSame($expected, array_map('mb_strtolower', $asc));
        $this->assertSame(array_reverse($expected), array_map('mb_strtolower', $names('sort=name&dir=desc')));

        // Same rows in every order, none twice, none missing.
        $this->assertEqualsCanonicalizing($unsorted, $asc);
        $this->assertCount(count($unsorted), array_unique($asc));

        // Unknown column: ignored, the default order stays.
        $this->assertSame($unsorted, $names('sort=password&dir=desc'));
    }

    public function test_a_pending_upgrade_shows_the_prorated_amount_to_pay_not_the_full_plan_price(): void
    {
        $school = School::where('school_code', 'SCHOOL-001')->first();
        SchoolSubscription::query()->delete();
        PaymentTransaction::query()->delete();
        $basic = SubscriptionPlan::updateOrCreate(['name' => 'Basic'], ['description' => 'Basic', 'monthly_price' => 1500, 'yearly_price' => 15000, 'is_active' => true]);
        SubscriptionPlan::updateOrCreate(['name' => 'Premium'], ['description' => 'Premium', 'monthly_price' => 3500, 'yearly_price' => 35000, 'is_active' => true]);
        $school->subscriptions()->create([
            'plan_id' => $basic->id, 'status' => 'active', 'billing_period' => 'monthly', 'list_price' => 1500, 'amount' => 1500,
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'start_date' => now()->subDays(10)->toDateString(), 'end_date' => now()->addDays(20)->toDateString(),
        ]);
        Sanctum::actingAs($this->dean());

        $this->postJson("/api/dean/schools/{$school->id}/upgrade-plan", ['plan_name' => 'Premium', 'billing_period' => 'monthly', 'payment_method' => 'bank_transfer'])->assertOk();

        $pending = $this->getJson('/api/auth/session/' . $this->dean()->id)->assertOk()->json('user.pending_upgrade');
        $this->assertNotNull($pending);
        $this->assertEquals($pending['breakdown']['total'], $pending['amount']);
        $this->assertLessThan(3500, (float) $pending['amount']);
    }
}
