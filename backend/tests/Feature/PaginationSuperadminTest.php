<?php

namespace Tests\Feature;

use App\Models\PlanInquiry;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Super Admin inquiries and support tickets grow without limit, so the server pages them. */
class PaginationSuperadminTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function inquiries(int $count, string $status): void
    {
        for ($i = 1; $i <= $count; $i++) {
            PlanInquiry::create(['school_name' => "School $status $i", 'contact_person' => 'A', 'email' => "$status$i@gmail.com", 'status' => $status]);
        }
    }

    public function test_inquiries_are_unpaged_without_page_and_paged_with_counts_when_asked(): void
    {
        $this->inquiries(20, 'new');
        $this->inquiries(5, 'approved');
        $this->inquiries(4, 'rejected');
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());

        $this->assertCount(29, $this->getJson('/api/superadmin/plan-inquiries')->assertOk()->json('inquiries'));

        $r = $this->getJson('/api/superadmin/plan-inquiries?page=1&statuses=new,contacted,under_discussion,approved')->assertOk();
        $this->assertCount(15, $r->json('inquiries'));
        $r->assertJsonPath('total', 25)->assertJsonPath('last_page', 2)->assertJsonPath('has_more', true)
            ->assertJsonPath('counts.new', 20)->assertJsonPath('counts.approved', 5)->assertJsonPath('counts.rejected', 4);

        $second = $this->getJson('/api/superadmin/plan-inquiries?page=2&statuses=new,contacted,under_discussion,approved')->assertOk();
        $this->assertCount(10, $second->json('inquiries'));
        $second->assertJsonPath('has_more', false);

        // a single-status chip filters the whole set; the archive view only holds rejected/converted
        $this->getJson('/api/superadmin/plan-inquiries?page=1&statuses=approved')->assertJsonPath('total', 5);
        $this->getJson('/api/superadmin/plan-inquiries?page=1&statuses=converted,rejected')->assertJsonPath('total', 4);
        $this->getJson('/api/superadmin/plan-inquiries?page=1&per_page=500')->assertJsonPath('per_page', 50);
    }

    public function test_support_tickets_are_paged_and_filter_by_status(): void
    {
        $coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        for ($i = 1; $i <= 22; $i++) {
            SupportTicket::create(['school_id' => $coordinator->school_id, 'coordinator_id' => $coordinator->id, 'subject' => "Help $i", 'category' => 'General', 'status' => $i <= 4 ? 'Resolved' : 'Open']);
        }
        Sanctum::actingAs(User::where('email', 'superadmin@internova.test')->first());

        $this->assertCount(22, $this->getJson('/api/superadmin/support-messages')->assertOk()->json('messages'));

        $r = $this->getJson('/api/superadmin/support-messages?page=1')->assertOk();
        $this->assertCount(15, $r->json('messages'));
        $r->assertJsonPath('total', 22)->assertJsonPath('last_page', 2);
        $this->assertCount(7, $this->getJson('/api/superadmin/support-messages?page=2')->json('messages'));

        $this->getJson('/api/superadmin/support-messages?page=1&status=Resolved')->assertJsonPath('total', 4);
        $this->getJson('/api/superadmin/support-messages?page=1&per_page=900')->assertJsonPath('per_page', 50);
    }

    public function test_only_the_super_admin_can_read_the_paged_lists(): void
    {
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->first());
        $this->getJson('/api/superadmin/plan-inquiries?page=1')->assertForbidden();
        $this->getJson('/api/superadmin/support-messages?page=1')->assertForbidden();
    }
}
