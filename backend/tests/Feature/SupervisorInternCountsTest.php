<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * "Active interns" means the same thing on the supervisor card, the company card and the company page:
 * interns with a set-up account. Interns who never activated the account are counted apart as "pending".
 */
class SupervisorInternCountsTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['status' => 'active', 'required_hours' => 500]);
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
    }

    private function supervisorRow(): array
    {
        return collect($this->getJson('/api/coordinator/supervisors')->assertOk()->json('supervisors'))->firstWhere('company_id', $this->dep->company_id);
    }

    public function test_an_activated_intern_counts_as_active(): void
    {
        User::whereKey($this->dep->intern_id)->update(['status' => 'active']);

        $row = $this->supervisorRow();
        $this->assertSame(1, $row['interns_count']);
        $this->assertSame(0, $row['pending_interns_count']);
    }

    public function test_a_pending_account_is_not_an_active_intern_anywhere(): void
    {
        User::whereKey($this->dep->intern_id)->update(['status' => 'pending_activation']);

        $row = $this->supervisorRow();
        $this->assertSame(0, $row['interns_count']);
        $this->assertSame(1, $row['pending_interns_count']);

        $company = collect($this->getJson('/api/coordinator/companies')->assertOk()->json('companies'))->firstWhere('id', $this->dep->company_id);
        $this->assertSame(0, $company['active_interns_count']);
        $this->assertSame(1, $company['pending_interns_count']);

        // The company page: the same numbers on the header tile and on its supervisor cards.
        $page = $this->getJson("/api/coordinator/companies/{$this->dep->company_id}")->assertOk();
        $this->assertSame(0, $page->json('summary.active'));
        $this->assertSame(1, $page->json('summary.invitation_pending'));
        foreach ($page->json('supervisors') as $s) {
            $this->assertSame(0, $s['interns_count']);
            $this->assertSame(1, $s['pending_interns_count']);
        }
    }

    public function test_a_finished_intern_is_neither_active_nor_pending(): void
    {
        User::whereKey($this->dep->intern_id)->update(['status' => 'active']);
        $this->dep->update(['status' => 'completed']);

        $row = $this->supervisorRow();
        $this->assertSame(0, $row['interns_count']);
        $this->assertSame(0, $row['pending_interns_count']);
        $this->assertSame(1, $row['completed_interns_count']);
    }
}
