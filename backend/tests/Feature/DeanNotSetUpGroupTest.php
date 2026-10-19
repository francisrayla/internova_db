<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\User;
use App\Services\DeanWeeklySummaryService;
use App\Services\InternMonitoringService as S;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An intern who never set up the account cannot clock in yet. The Dean must not count them as "On track":
 * they form their own group ("Not set up yet"), apart from on track / at risk, like the coordinator's pending accounts.
 */
class DeanNotSetUpGroupTest extends TestCase
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
    }

    private function dean(): User
    {
        return User::where('email', 'dean@internova.test')->firstOrFail();
    }

    private function setAccount(string $status): void
    {
        User::whereKey($this->dep->intern_id)->update(['status' => $status]);
    }

    public function test_classify_puts_a_pending_account_in_its_own_group(): void
    {
        $ok = ['late' => false];
        $this->assertSame('not_set_up', S::classify('active', false, [], 0, $ok, true)['group']);
        $this->assertSame('Not set up yet', S::classify('active', false, [], 0, $ok, true)['label']);
        // Even with flags, a pending account is not "at risk": it has no account to track yet.
        $flag = ['key' => 'evaluation_due', 'level' => 'amber', 'label' => 'x'];
        $this->assertSame('not_set_up', S::classify('active', false, [$flag, $flag], 0, ['late' => true], true)['group']);
        // Finished and withdrawn deployments keep their own group.
        $this->assertSame('completed', S::classify('completed', false, [], 0, $ok, true)['group']);
        $this->assertSame('inactive', S::classify('inactive', false, [], 0, $ok, true)['group']);
        $this->assertSame('on_track', S::classify('active', false, [], 0, $ok, false)['group']);
    }

    public function test_overview_counts_a_pending_account_apart_from_the_tracked_groups(): void
    {
        $this->setAccount('active');
        Sanctum::actingAs($this->dean());
        $before = $this->getJson('/api/dean/overview')->assertOk()->json('progress.groups');
        $this->assertSame(0, $before['not_set_up']);

        $this->setAccount('pending_activation');
        $after = $this->getJson('/api/dean/overview')->assertOk()->json('progress');

        $tracked = fn (array $g) => $g['at_risk'] + $g['needs_attention'] + $g['on_track'];
        $this->assertSame(1, $after['groups']['not_set_up']);
        $this->assertSame($tracked($before) - 1, $tracked($after['groups']));
        $this->assertSame($after['interns_pending_accounts'], $after['groups']['not_set_up']);
    }

    public function test_interns_list_filters_and_labels_the_group(): void
    {
        $this->setAccount('pending_activation');
        Sanctum::actingAs($this->dean());

        $res = $this->getJson('/api/dean/interns?group=not_set_up')->assertOk();
        $this->assertSame(1, $res->json('summary.not_set_up'));
        $this->assertCount(1, $res->json('interns'));
        $this->assertSame('not_set_up', $res->json('interns.0.status_group'));
        $this->assertSame('Not set up yet', $res->json('interns.0.status_group_label'));
        $this->assertSame(0, collect($this->getJson('/api/dean/interns?group=on_track')->json('interns'))->where('deployment_id', $this->dep->id)->count());
        $this->getJson('/api/dean/interns?sort=group')->assertOk();
    }

    public function test_the_coordinator_shows_the_same_intern_as_a_pending_account(): void
    {
        $this->setAccount('pending_activation');
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $this->assertSame(1, $this->getJson('/api/coordinator/interns')->assertOk()->json('summary.invitation_pending'));
    }

    public function test_weekly_summary_carries_the_new_group(): void
    {
        $this->setAccount('pending_activation');
        $groups = DeanWeeklySummaryService::build($this->dean())['groups'];
        $this->assertSame(1, $groups['not_set_up']);
        $this->assertSame(array_sum(array_diff_key($groups, ['total' => 1])), $groups['total']);
    }
}
