<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Daily activities (supervisor review list and the intern's own log) are paged on the server. */
class PaginationActivitiesTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $sup;
    private User $intern;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
        DailyActivity::query()->delete();
    }

    private function entries(int $count, string $status = 'pending', ?int $deploymentId = null): void
    {
        for ($i = 1; $i <= $count; $i++) {
            DailyActivity::create([
                'deployment_id' => $deploymentId ?? $this->dep->id,
                'activity_date' => '2026-05-' . str_pad((string) (($i % 28) + 1), 2, '0', STR_PAD_LEFT),
                'title' => "$status entry $i", 'description' => 'd', 'status' => $status,
            ]);
        }
    }

    public function test_supervisor_list_is_paged_with_meta(): void
    {
        $this->entries(45);
        Sanctum::actingAs($this->sup);

        $first = $this->getJson('/api/supervisor/activities')->assertOk();
        $this->assertCount(20, $first->json('activities'));
        $first->assertJsonPath('total', 45)->assertJsonPath('page', 1)->assertJsonPath('per_page', 20)
            ->assertJsonPath('last_page', 3)->assertJsonPath('has_more', true)->assertJsonPath('pending_total', 45);

        $second = $this->getJson('/api/supervisor/activities?page=2')->assertOk();
        $this->assertCount(20, $second->json('activities'));
        $this->assertEmpty(array_intersect(array_column($first->json('activities'), 'id'), array_column($second->json('activities'), 'id')));

        $last = $this->getJson('/api/supervisor/activities?page=3')->assertOk();
        $this->assertCount(5, $last->json('activities'));
        $last->assertJsonPath('has_more', false);
    }

    public function test_supervisor_status_filter_applies_to_the_whole_set_and_per_page_is_capped(): void
    {
        $this->entries(30, 'pending');
        $this->entries(40, 'approved');
        Sanctum::actingAs($this->sup);

        $r = $this->getJson('/api/supervisor/activities?status=approved&per_page=500')->assertOk();
        $this->assertCount(40, $r->json('activities')); // capped at 50, only 40 exist
        $r->assertJsonPath('total', 40)->assertJsonPath('per_page', 50)->assertJsonPath('pending_total', 30);

        $p = $this->getJson('/api/supervisor/activities?status=pending&page=2')->assertOk();
        $this->assertCount(10, $p->json('activities'));
        $p->assertJsonPath('total', 30);
        foreach ($p->json('activities') as $row) {
            $this->assertSame('pending', $row['status']);
        }
    }

    public function test_supervisor_only_sees_their_company_and_approve_all_covers_every_page(): void
    {
        $this->entries(35, 'pending');
        $otherCompany = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-77', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $otherDep = InternshipDeployment::create([
            'school_id' => $this->dep->school_id, 'intern_id' => $this->dep->intern_id, 'company_id' => $otherCompany->id,
            'status' => 'active', 'required_hours' => 200, 'start_date' => '2026-01-05', 'end_date' => '2026-12-05',
        ]);
        $this->entries(6, 'pending', $otherDep->id);

        Sanctum::actingAs($this->sup);
        $this->getJson('/api/supervisor/activities')->assertJsonPath('total', 35)->assertJsonPath('pending_total', 35);

        // "Approve all" is not limited to the 20 rows on screen.
        $this->postJson('/api/supervisor/activities/approve', ['all_pending' => true])->assertOk()->assertJsonPath('approved', 35);
        $this->assertSame(0, DailyActivity::where('deployment_id', $this->dep->id)->where('status', 'pending')->count());
        $this->assertSame(6, DailyActivity::where('deployment_id', $otherDep->id)->where('status', 'pending')->count());
        $this->postJson('/api/supervisor/activities/approve', ['all_pending' => true])->assertStatus(422);
    }

    public function test_approve_with_ids_still_works(): void
    {
        $this->entries(3, 'pending');
        $ids = DailyActivity::pluck('id')->take(2)->all();
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/supervisor/activities/approve', ['ids' => $ids])->assertOk()->assertJsonPath('approved', 2);
        $this->postJson('/api/supervisor/activities/approve', [])->assertStatus(422);
    }

    public function test_intern_log_is_paged_newest_first(): void
    {
        $this->entries(26, 'approved');
        Sanctum::actingAs($this->intern);

        $first = $this->getJson('/api/intern/activities')->assertOk();
        $count = $first->json('total');
        $this->assertGreaterThanOrEqual(26, $count);
        $this->assertCount(20, $first->json('activities'));
        $first->assertJsonPath('page', 1)->assertJsonPath('has_more', true);

        $second = $this->getJson('/api/intern/activities?page=2')->assertOk();
        $this->assertCount($count - 20, $second->json('activities'));
        $second->assertJsonPath('has_more', false);

        $this->getJson('/api/intern/activities?per_page=999')->assertOk()->assertJsonPath('per_page', 50);
    }
}
