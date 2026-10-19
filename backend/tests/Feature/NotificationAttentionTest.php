<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\Document;
use App\Models\InternshipDeployment;
use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\SupervisorProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * GET /api/notifications/attention: the live "Needs your attention" list in the bell. It is built from the
 * signed-in user ONLY, so a request can never ask for another role's, school's or person's list.
 */
class NotificationAttentionTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['status' => 'active', 'required_hours' => 8, 'start_date' => now()->subDays(20)->toDateString(), 'end_date' => now()->addDays(60)->toDateString()]);
    }

    private function as(string $email): User
    {
        $u = User::where('email', "{$email}@internova.test")->firstOrFail();
        Sanctum::actingAs($u);

        return $u;
    }

    private function items(string $url = '/api/notifications/attention'): \Illuminate\Support\Collection
    {
        return collect($this->getJson($url)->assertOk()->json('items'))->keyBy('key');
    }

    private function newUser(string $role, string $email, int $schoolId): User
    {
        return User::create([
            'name' => ucfirst($role) . ' X', 'email' => $email, 'password' => bcrypt('password'),
            'role_id' => Role::where('name', $role)->value('id'), 'school_id' => $schoolId,
            'first_name' => ucfirst($role), 'last_name' => 'X', 'status' => 'active', 'email_verified_at' => now(),
        ]);
    }

    private function flaggedClockIn(InternshipDeployment $d): Attendance
    {
        $in = now()->subDay()->setTime(20, 0);

        return Attendance::create(['deployment_id' => $d->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHour(), 'status' => 'approved', 'clock_in_odd_hours' => true]);
    }

    public function test_it_needs_a_signed_in_user(): void
    {
        $this->getJson('/api/notifications/attention')->assertUnauthorized();
    }

    public function test_the_supervisor_sees_their_own_company_backlog_with_a_working_link(): void
    {
        $this->as('supervisor');
        $this->assertSame([], $this->items()->keys()->intersect(['red_flags'])->all());

        $this->flaggedClockIn($this->dep);
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $item = collect($res->json('items'))->firstWhere('key', 'red_flags');
        $this->assertSame(1, $item['count']);
        $this->assertSame('red', $item['tone']);
        $this->assertSame('/supervisor/attendance?flag=unchecked', $item['href']);
        $this->assertFalse($item['info']);
        $this->assertGreaterThanOrEqual(1, $res->json('badge'));
    }

    public function test_a_supervisor_of_another_company_does_not_see_it(): void
    {
        $this->flaggedClockIn($this->dep);
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'ZZ1', 'company_name' => 'Other Co', 'status' => 'active']);
        $stranger = $this->newUser('supervisor', 'stranger@internova.test', $this->dep->school_id);
        SupervisorProfile::create(['user_id' => $stranger->id, 'school_id' => $this->dep->school_id, 'company_id' => $other->id]);

        Sanctum::actingAs($stranger);
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $this->assertSame([], $res->json('items'));
        $this->assertSame(0, $res->json('badge'));
    }

    public function test_the_coordinator_sees_their_school_and_a_coordinator_of_another_school_does_not(): void
    {
        Document::create(['deployment_id' => $this->dep->id, 'uploaded_by' => $this->dep->intern_id, 'document_type' => 'Resume', 'file_name' => 'r.pdf', 'file_path' => 'x/r.pdf', 'status' => 'pending']);

        $this->as('coordinator');
        $docs = $this->items()->get('documents');
        $this->assertSame(1, $docs['count']);
        $this->assertSame('/coordinator/documents', $docs['href']);

        $school2 = School::create(['school_code' => 'OTHER-1', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        Sanctum::actingAs($this->newUser('coordinator', 'othercoord@internova.test', $school2->id));
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $this->assertSame([], $res->json('items'));
        $this->assertSame(0, $res->json('badge'));
    }

    public function test_the_dean_gets_the_school_alerts_and_another_school_does_not(): void
    {
        $school = School::findOrFail($this->dep->school_id);
        $school->subscriptions()->latest('id')->first()->forceFill(['status' => 'expired', 'end_date' => now()->subDays(3)])->save();

        $this->as('dean');
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $item = collect($res->json('items'))->firstWhere('key', 'subscription_inactive');
        $this->assertNotNull($item);
        $this->assertSame('red', $item['tone']);
        $this->assertSame('/dean/billing', $item['href']);
        $this->assertContains('no_clock_in', collect($res->json('items'))->pluck('key')->all()); // the seeded intern never clocked in

        $school2 = School::create(['school_code' => 'OTHER-2', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        Sanctum::actingAs($this->newUser('dean', 'otherdean@internova.test', $school2->id));
        $keys = $this->items()->keys()->all();
        $this->assertNotContains('no_clock_in', $keys); // no interns there
        $this->assertNotContains('behind_hours', $keys);
    }

    public function test_the_intern_sees_their_own_next_step_and_finished_news_is_listed_but_not_counted(): void
    {
        $this->as('intern');
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $this->assertSame('Clock in for today', collect($res->json('items'))->firstWhere('key', 'clock_in')['title']);
        $this->assertSame(1, $res->json('badge'));

        $in = now()->subDay()->setTime(1, 0);
        Attendance::create(['deployment_id' => $this->dep->id, 'attendance_date' => $in->toDateString(), 'clock_in' => $in, 'clock_out' => $in->copy()->addHours(8), 'status' => 'approved']);
        $res = $this->getJson('/api/notifications/attention')->assertOk();
        $items = collect($res->json('items'))->keyBy('key');
        $this->assertTrue($items['finished']['info']);
        $this->assertTrue($items['evaluation']['info']);
        // The rest (missing documents, report items) still needs the intern; only the pure news is left out of the badge.
        $this->assertSame($items->where('info', false)->count(), $res->json('badge'));
        $this->assertLessThan($items->count(), $res->json('badge'));
    }

    public function test_the_super_admin_sees_the_platform_queue_and_other_roles_never_do(): void
    {
        PlanInquiry::create(['school_name' => 'New U', 'contact_person' => 'A', 'email' => 'a@gmail.com', 'status' => 'new']);

        $this->as('superadmin');
        $this->assertSame('/superadmin/inquiries', $this->items()->get('inquiries')['href']);

        foreach (['dean', 'coordinator', 'supervisor', 'intern'] as $role) {
            $this->as($role);
            $this->assertNotContains('inquiries', $this->items()->keys()->all(), "{$role} must not see super admin items");
        }
    }

    public function test_nothing_from_the_request_can_change_whose_list_it_is(): void
    {
        PlanInquiry::create(['school_name' => 'New U', 'contact_person' => 'A', 'email' => 'a@gmail.com', 'status' => 'new']);
        $other = $this->newUser('coordinator', 'othercoord@internova.test', School::create(['school_code' => 'OTHER-3', 'school_name' => 'Other', 'address' => 'x', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active'])->id);

        $this->as('intern');
        $url = '/api/notifications/attention?audience_role=super_admin&role=super_admin&school_id=999&user_id=' . $other->id;
        $keys = $this->items($url)->keys()->all();
        $this->assertContains('clock_in', $keys);       // still the intern's own list
        $this->assertNotContains('inquiries', $keys);   // never the super admin's
    }

    public function test_a_sent_back_document_stops_counting_once_a_new_file_is_uploaded(): void
    {
        $doc = fn (string $type, string $status, ?string $remarks = null) => Document::create([
            'deployment_id' => $this->dep->id, 'uploaded_by' => $this->dep->intern_id, 'document_type' => $type,
            'file_name' => 'f.pdf', 'file_path' => 'x/f.pdf', 'status' => $status, 'remarks' => $remarks,
        ]);
        $this->as('intern');

        $doc('Endorsement Letter', 'rejected', 'Blurry scan, please upload again.');
        $doc('Waiver', 'rejected');
        $item = $this->items()->get('rejected_documents');
        $this->assertSame(2, $item['count']);
        $this->assertSame('Read the remarks and upload a corrected file.', $item['detail']);

        // Re-uploaded (pending review): that one no longer counts.
        $doc('endorsement letter ', 'pending');
        $item = $this->items()->get('rejected_documents');
        $this->assertSame(1, $item['count']);
        $this->assertSame('Upload a corrected file.', $item['detail'], 'the one left has no remarks');

        // The new file is approved, and the other one is fixed too: nothing is sent back any more.
        $doc('Waiver', 'approved');
        $this->assertNull($this->items()->get('rejected_documents'));

        // A re-upload that is rejected again counts again.
        $doc('Waiver', 'rejected', 'Wrong page.');
        $this->assertSame(1, $this->items()->get('rejected_documents')['count']);
    }
}
