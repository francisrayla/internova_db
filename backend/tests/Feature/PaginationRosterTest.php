<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Coordinator and Dean lists (interns, documents, evaluations) are cut into pages on the server. */
class PaginationRosterTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $coordinator;
    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->dean = User::where('email', 'dean@internova.test')->firstOrFail();
    }

    /** More interns in the same school and company. */
    private function interns(int $count, string $prefix = 'Pat', string $status = 'active'): void
    {
        $role = Role::where('name', 'intern')->value('id');
        for ($i = 1; $i <= $count; $i++) {
            $u = User::create([
                'name' => "$prefix $i Cruz", 'email' => strtolower($prefix) . "$i@pg.test", 'password' => bcrypt('password'),
                'role_id' => $role, 'school_id' => $this->dep->school_id, 'first_name' => "$prefix $i", 'last_name' => 'Cruz',
                'status' => 'active', 'email_verified_at' => now(),
            ]);
            InternProfile::create(['user_id' => $u->id, 'school_id' => $this->dep->school_id, 'student_number' => "PG-$prefix-$i", 'course' => 'BS Information Technology', 'year_level' => '4th Year', 'required_hours' => 480]);
            InternshipDeployment::create([
                'intern_id' => $u->id, 'company_id' => $this->dep->company_id, 'school_id' => $this->dep->school_id,
                'coordinator_id' => $this->dep->coordinator_id, 'start_date' => now()->subMonth()->toDateString(),
                'end_date' => now()->addMonths(2)->toDateString(), 'required_hours' => 480, 'status' => $status,
            ]);
        }
    }

    private function documents(int $count, string $status): void
    {
        for ($i = 1; $i <= $count; $i++) {
            Document::create([
                'deployment_id' => $this->dep->id, 'uploaded_by' => $this->dep->intern_id, 'document_type' => "Doc $status $i",
                'file_name' => 'x.pdf', 'file_path' => 'documents/1/x.pdf', 'status' => $status,
            ]);
        }
    }

    public function test_coordinator_documents_are_paged_and_filter_before_paging(): void
    {
        $this->documents(30, 'pending');
        $this->documents(25, 'approved');
        Sanctum::actingAs($this->coordinator);

        $r = $this->getJson('/api/coordinator/documents')->assertOk();
        $this->assertCount(20, $r->json('documents'));
        $r->assertJsonPath('total', 55)->assertJsonPath('last_page', 3)->assertJsonPath('has_more', true);
        $this->assertNotEmpty($r->json('interns')); // upload dialog options still ride along

        $this->assertCount(15, $this->getJson('/api/coordinator/documents?page=3')->json('documents'));

        $p = $this->getJson('/api/coordinator/documents?status=pending&page=2')->assertOk();
        $this->assertCount(10, $p->json('documents'));
        $p->assertJsonPath('total', 30);
        foreach ($p->json('documents') as $row) {
            $this->assertSame('pending', $row['status']);
        }

        $this->getJson('/api/coordinator/documents?per_page=1000')->assertJsonPath('per_page', 50);
        $this->getJson('/api/coordinator/documents?per_page=5&status=pending')->assertJsonCount(5, 'documents')->assertJsonPath('total', 30);
    }

    public function test_coordinator_documents_stay_inside_the_school(): void
    {
        $this->documents(3, 'pending');
        $other = School::create(['school_code' => 'OTHER-9', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o9@o.test', 'contact_number' => '09170000009', 'status' => 'active']);
        $outsider = User::create([
            'name' => 'Out Sider', 'email' => 'outsider@pg.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'coordinator')->value('id'), 'school_id' => $other->id,
            'first_name' => 'Out', 'last_name' => 'Sider', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        Sanctum::actingAs($outsider);
        $this->getJson('/api/coordinator/documents')->assertOk()->assertJsonPath('total', 0);
    }

    public function test_coordinator_evaluations_page_and_search_whole_set(): void
    {
        $this->interns(18, 'Eval');
        foreach (InternshipDeployment::all() as $d) {
            Evaluation::create(['deployment_id' => $d->id, 'evaluator_id' => $this->coordinator->id, 'evaluation_date' => '2026-05-01', 'overall_score' => 80, 'remarks' => 'ok', 'status' => 'submitted']);
        }
        Sanctum::actingAs($this->coordinator);

        $r = $this->getJson('/api/coordinator/evaluations')->assertOk();
        $this->assertCount(15, $r->json('evaluations'));
        $r->assertJsonPath('total', 19)->assertJsonPath('last_page', 2)->assertJsonPath('per_page', 15);
        $this->assertCount(4, $this->getJson('/api/coordinator/evaluations?page=2')->json('evaluations'));

        // Search covers every page, and paging applies to the matches.
        $s = $this->getJson('/api/coordinator/evaluations?search=Eval 17')->assertOk();
        $s->assertJsonPath('total', 1);
        $this->assertStringContainsString('Eval 17', $s->json('evaluations.0.intern_name'));
        $this->getJson('/api/coordinator/evaluations?search=Cruz&per_page=5&page=2')->assertJsonCount(5, 'evaluations')->assertJsonPath('total', 18);
        $this->getJson('/api/coordinator/evaluations?per_page=99')->assertJsonPath('per_page', 50);
    }

    public function test_coordinator_interns_unpaged_by_default_and_paged_when_asked(): void
    {
        $this->interns(24, 'Roster');
        Sanctum::actingAs($this->coordinator);

        $all = $this->getJson('/api/coordinator/interns')->assertOk();
        $this->assertCount(25, $all->json('interns')); // dashboards and other readers still get everything
        $this->assertArrayNotHasKey('last_page', $all->json());

        $p1 = $this->getJson('/api/coordinator/interns?page=1&scope=roster&filter=all')->assertOk();
        $this->assertCount(15, $p1->json('interns'));
        $p1->assertJsonPath('total', 25)->assertJsonPath('last_page', 2)->assertJsonPath('has_more', true)
            ->assertJsonPath('summary.total', 25);
        $this->assertContains('BS Information Technology', $p1->json('options.courses'));
        $this->assertCount(10, $this->getJson('/api/coordinator/interns?page=2&scope=roster&filter=all')->json('interns'));

        // search + page: the match is found even though it is on a later page of the unfiltered list
        $s = $this->getJson('/api/coordinator/interns?page=1&scope=roster&search=PG-Roster-24')->assertOk();
        $s->assertJsonPath('total', 1);
        $this->assertSame('Roster 24 Cruz', $s->json('interns.0.intern_name'));
        // the summary still describes the whole school list
        $s->assertJsonPath('summary.total', 25);

        $this->getJson('/api/coordinator/interns?page=1&per_page=500')->assertJsonPath('per_page', 50);
    }

    public function test_coordinator_archive_scope_and_company_filter(): void
    {
        $this->interns(3, 'Gone', 'inactive');
        $this->interns(2, 'Here');
        Sanctum::actingAs($this->coordinator);

        $archive = $this->getJson('/api/coordinator/interns?page=1&scope=archive')->assertOk();
        $archive->assertJsonPath('total', 3);
        foreach ($archive->json('interns') as $row) {
            $this->assertSame('inactive', $row['status']);
        }
        $roster = $this->getJson('/api/coordinator/interns?page=1&scope=roster')->assertOk();
        $roster->assertJsonPath('total', 3); // seeded intern + 2
        $company = $roster->json('interns.0.company_name');
        $this->getJson('/api/coordinator/interns?page=1&scope=roster&company=' . urlencode($company))->assertJsonPath('total', 3);
        $this->getJson('/api/coordinator/interns?page=1&scope=roster&company=Nowhere')->assertJsonPath('total', 0);
    }

    public function test_pending_accounts_list_is_paged_by_the_invitation_filter(): void
    {
        $this->interns(17, 'Wait');
        User::where('email', 'like', '%@pg.test')->update(['status' => 'pending_activation']);
        Sanctum::actingAs($this->coordinator);

        $r = $this->getJson('/api/coordinator/interns?page=1&per_page=15&scope=roster&filter=invitation_pending')->assertOk();
        $this->assertCount(15, $r->json('interns'));
        $r->assertJsonPath('total', 17)->assertJsonPath('last_page', 2)->assertJsonPath('summary.invitation_pending', 17);
        foreach ($r->json('interns') as $row) {
            $this->assertSame('invitation_pending', $row['display_status']);
        }
        $this->assertCount(2, $this->getJson('/api/coordinator/interns?page=2&per_page=15&scope=roster&filter=invitation_pending')->json('interns'));
        // the normal roster ("All") leaves them out
        $this->getJson('/api/coordinator/interns?page=1&scope=roster&filter=all')->assertJsonPath('total', 1);
    }

    public function test_dean_interns_are_paged_after_filters_and_stay_unpaged_without_page(): void
    {
        $this->interns(20, 'Dean');
        Sanctum::actingAs($this->dean);

        $this->assertCount(21, $this->getJson('/api/dean/interns')->assertOk()->json('interns'));

        $r = $this->getJson('/api/dean/interns?page=1&per_page=18')->assertOk();
        $this->assertCount(18, $r->json('interns'));
        $r->assertJsonPath('total', 21)->assertJsonPath('last_page', 2);
        $this->assertCount(3, $this->getJson('/api/dean/interns?page=2&per_page=18')->json('interns'));

        $f = $this->getJson('/api/dean/interns?page=1&search=Dean 7')->assertOk();
        $this->assertGreaterThanOrEqual(1, $f->json('total'));
        foreach ($f->json('interns') as $row) {
            $this->assertStringContainsString('Dean 7', $row['intern_name']);
        }
        $this->getJson('/api/dean/interns?page=1&per_page=900')->assertJsonPath('per_page', 50);
    }
}
