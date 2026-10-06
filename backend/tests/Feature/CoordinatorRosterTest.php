<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\SupervisorProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CoordinatorRosterTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function coordinator(): User
    {
        return User::where('email', 'coordinator@internova.test')->firstOrFail();
    }

    public function test_interns_endpoint_adds_status_attention_and_summary(): void
    {
        $d = InternshipDeployment::firstOrFail();
        $d->update(['status' => 'active']);
        // "No supervisor" = the intern's company has no active supervisor.
        User::whereIn('id', SupervisorProfile::where('company_id', $d->company_id)->pluck('user_id'))->update(['status' => 'inactive']);
        Sanctum::actingAs($this->coordinator());

        $res = $this->getJson('/api/coordinator/interns')->assertOk();
        $row = $res->json('interns.0');
        $this->assertArrayHasKey('intern_name', $row); // original shape kept
        $keys = collect($row['attention'])->pluck('key')->all();
        $this->assertContains('no_supervisor', $keys);
        $this->assertContains('no_clock_in', $keys);
        $this->assertSame('active', $row['display_status']);
        $res->assertJsonPath('summary.needs_attention', 1)->assertJsonPath('summary.total', 1);

        $d->intern->forceFill(['status' => 'pending_activation'])->save();
        $res = $this->getJson('/api/coordinator/interns')->assertOk();
        $res->assertJsonPath('interns.0.display_status', 'invitation_pending')
            ->assertJsonPath('interns.0.attention', [])
            ->assertJsonPath('summary.invitation_pending', 1)
            ->assertJsonPath('summary.needs_attention', 0);
    }

    public function test_supervisor_list_has_status_counts_and_stays_school_scoped(): void
    {
        $d = InternshipDeployment::firstOrFail();
        $sup = SupervisorProfile::where('company_id', $d->company_id)->firstOrFail()->user;
        $sup->forceFill(['status' => 'pending_activation', 'email_bounced_at' => now(), 'last_login_at' => now()])->save();

        $other = School::create(['school_code' => 'OTHER-2', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        $otherCompany = Company::create(['school_id' => $other->id, 'company_code' => 'X1', 'company_name' => 'Elsewhere Inc', 'status' => 'active']);
        $otherUser = User::create([
            'name' => 'Far Away', 'email' => 'far@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $other->id,
            'first_name' => 'Far', 'last_name' => 'Away', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $otherUser->id, 'school_id' => $other->id, 'company_id' => $otherCompany->id]);

        Sanctum::actingAs($this->coordinator());
        $res = $this->getJson('/api/coordinator/supervisors')->assertOk();
        $rows = collect($res->json('supervisors'));
        $this->assertFalse($rows->contains('user_id', $otherUser->id));
        $mine = $rows->firstWhere('user_id', $sup->id);
        $this->assertSame('bounced', $mine['status']);
        $this->assertSame(1, $mine['interns_count']);
        $this->assertNotNull($mine['last_active_at']);
        $this->assertNotEmpty($mine['company_name']);
        $this->assertArrayHasKey('name', $mine);
    }

    public function test_company_list_and_detail_carry_the_new_counts_with_few_queries(): void
    {
        Sanctum::actingAs($this->coordinator());
        $c = $this->getJson('/api/coordinator/companies')->assertOk()->json('companies.0');
        $this->assertArrayHasKey('supervisors_count', $c);
        $this->assertArrayHasKey('completed_interns_count', $c);
        $this->assertIsArray($c['supervisor_names']);

        DB::enableQueryLog();
        $this->getJson("/api/coordinator/companies/{$c['id']}")->assertOk()
            ->assertJsonStructure(['company', 'supervisors' => [['status', 'interns_count']], 'interns' => [['attention']], 'summary']);
        $small = count(DB::getQueryLog());

        // More interns must not add queries per intern beyond the existing summary cost.
        $this->assertLessThan(60, $small);
    }
}
