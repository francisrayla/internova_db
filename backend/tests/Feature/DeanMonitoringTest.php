<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\DeanFeedback;
use App\Models\DeanProfile;
use App\Models\Document;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\School;
use App\Models\User;
use App\Services\ActivityLogService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DeanMonitoringTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function user(string $email): User
    {
        return User::where('email', $email)->first();
    }

    private function dean(): User
    {
        return $this->user('dean@internova.test');
    }

    private function deployment(): InternshipDeployment
    {
        return InternshipDeployment::firstOrFail();
    }

    private function pendingDocument(int $daysOld, string $type = 'Resume'): Document
    {
        $d = $this->deployment();
        $doc = Document::create([
            'deployment_id' => $d->id, 'uploaded_by' => $d->intern_id, 'document_type' => $type,
            'file_name' => 'x.pdf', 'file_path' => 'documents/1/x.pdf', 'status' => 'pending',
        ]);
        $doc->forceFill(['created_at' => now()->subDays($daysOld)])->save();

        return $doc;
    }

    private function otherSchoolDean(): User
    {
        $school = School::create(['school_code' => 'OTHER-1', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        $user = User::create([
            'name' => 'Other Dean', 'email' => 'otherdean@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'dean')->value('id'), 'school_id' => $school->id,
            'first_name' => 'Other', 'last_name' => 'Dean', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        DeanProfile::create(['user_id' => $user->id, 'school_id' => $school->id, 'position' => 'Dean']);

        return $user;
    }

    public function test_overview_alerts_are_computed_from_real_data(): void
    {
        $this->pendingDocument(5);
        Sanctum::actingAs($this->dean());

        $res = $this->getJson('/api/dean/overview')->assertOk();
        $alerts = collect($res->json('alerts'))->keyBy('key');

        $this->assertTrue($alerts->has('stale_documents'));
        $this->assertStringContainsString('1 document has waited more than 3 days', $alerts['stale_documents']['title']);
        $this->assertSame('/dean/coordinator?tab=pending', $alerts['stale_documents']['link']);
        // Seeded deployment started a month ago with no clock-ins and no hours.
        $this->assertTrue($alerts->has('no_clock_in'));
        $this->assertTrue($alerts->has('behind_hours'));
        $res->assertJsonPath('progress.interns_total', 1)
            ->assertJsonPath('coordinator.email', 'coordinator@internova.test')
            ->assertJsonPath('school.name', $this->dean()->school->school_name);
    }

    public function test_a_recent_clock_in_and_fresh_document_raise_no_attention_alerts(): void
    {
        $d = $this->deployment();
        $d->update(['start_date' => now()->toDateString(), 'end_date' => now()->addMonths(3)->toDateString()]);
        $this->pendingDocument(1);
        Attendance::create(['deployment_id' => $d->id, 'attendance_date' => now()->toDateString(), 'clock_in' => now()->subHours(2), 'status' => 'approved']);
        Sanctum::actingAs($this->dean());

        $keys = collect($this->getJson('/api/dean/overview')->assertOk()->json('alerts'))->pluck('key')->all();
        $this->assertNotContains('stale_documents', $keys);
        $this->assertNotContains('no_clock_in', $keys);
        $this->assertNotContains('behind_hours', $keys);
    }

    public function test_activity_is_scoped_to_the_coordinator_paginated_and_filterable(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $school = $coordinator->school_id;
        for ($i = 1; $i <= 7; $i++) {
            ActivityLogService::record('Documents', "Approved document {$i}", 'x', $school, $coordinator->id);
        }
        ActivityLogService::record('Interns', 'Invited intern', 'y', $school, $coordinator->id);
        ActivityLogService::record('Documents', 'Supervisor thing', 'z', $school, $this->user('supervisor@internova.test')->id);
        $other = $this->otherSchoolDean();
        ActivityLogService::record('Documents', 'Other school', 'z', $other->school_id, $coordinator->id);

        Sanctum::actingAs($this->dean());
        $first = $this->getJson('/api/dean/coordinator/activity?per_page=5')->assertOk();
        $this->assertCount(5, $first->json('items'));
        $this->assertSame(8, $first->json('total'));
        $this->assertTrue($first->json('has_more'));
        $this->assertEqualsCanonicalizing(['Documents', 'Interns'], $first->json('modules'));

        $this->getJson('/api/dean/coordinator/activity?per_page=5&page=2')->assertOk()->assertJsonCount(3, 'items');
        $filtered = $this->getJson('/api/dean/coordinator/activity?module=Interns')->assertOk();
        $this->assertSame(['Invited intern'], collect($filtered->json('items'))->pluck('action')->all());
    }

    public function test_coordinator_actions_are_recorded_in_the_activity_log(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        $company = $this->deployment()->company;
        Sanctum::actingAs($coordinator);

        $this->patchJson("/api/coordinator/companies/{$company->id}", ['company_name' => 'ABC Tech Renamed'])->assertOk();
        $this->postJson('/api/coordinator/evaluation-criteria', ['name' => 'Initiative', 'max_score' => 5, 'weight' => 1])->assertOk();
        $task = \App\Models\Task::firstOrFail();
        $this->postJson("/api/coordinator/tasks/{$task->id}/comments", ['comment' => 'Looks good'])->assertOk();
        $this->patchJson('/api/coordinator/narrative-template', ['cover' => ['department' => 'CCS']])->assertOk();

        $actions = ActivityLog::where('user_id', $coordinator->id)->pluck('action')->all();
        foreach (['Updated partner company', 'Added evaluation criterion', 'Commented on a task', 'Updated narrative report template'] as $a) {
            $this->assertContains($a, $actions);
        }
    }

    public function test_pending_items_have_ages_oldest_first_and_stale_flags(): void
    {
        $this->pendingDocument(6, 'Waiver');
        $this->pendingDocument(1, 'Resume');
        Sanctum::actingAs($this->dean());

        $res = $this->getJson('/api/dean/coordinator/pending')->assertOk();
        $items = collect($res->json('items'));
        $docs = $items->where('type', 'document_review')->values();
        $this->assertCount(2, $docs);
        $this->assertSame(6, $docs[0]['age_days']);
        $this->assertTrue($docs[0]['stale']);
        $this->assertFalse($docs[1]['stale']);
        $this->assertStringContainsString('Waiting 6 days', $docs[0]['detail']);
        $ages = $items->pluck('age_days')->all();
        $sorted = $ages;
        rsort($sorted);
        $this->assertSame($sorted, $ages);
        $this->assertTrue($items->contains('type', 'narrative_template'));
    }

    public function test_feedback_flows_from_dean_to_coordinator_and_is_marked_read(): void
    {
        $coordinator = $this->user('coordinator@internova.test');
        Sanctum::actingAs($this->dean());

        $this->postJson('/api/dean/coordinator/feedback', ['message' => ''])->assertStatus(422);
        $this->postJson('/api/dean/coordinator/feedback', ['message' => 'Please review the pending documents.'])->assertCreated();

        $this->assertDatabaseHas('notifications', ['audience_role' => 'coordinator', 'user_id' => $coordinator->id, 'type' => 'dean_feedback']);
        $list = $this->getJson('/api/dean/coordinator/feedback')->assertOk();
        $this->assertFalse($list->json('items.0.seen'));

        Sanctum::actingAs($coordinator);
        $this->getJson('/api/coordinator/feedback/unread-count')->assertOk()->assertJsonPath('unread_count', 1);
        $mine = $this->getJson('/api/coordinator/feedback')->assertOk();
        $this->assertSame('Please review the pending documents.', $mine->json('items.0.message'));
        $this->postJson('/api/coordinator/feedback/read-all')->assertOk();
        $this->getJson('/api/coordinator/feedback/unread-count')->assertJsonPath('unread_count', 0);

        Sanctum::actingAs($this->dean());
        $this->assertTrue($this->getJson('/api/dean/coordinator/feedback')->json('items.0.seen'));

        // A coordinator can't mark someone else's feedback read; interns can't use the page.
        $other = DeanFeedback::create(['school_id' => $coordinator->school_id, 'dean_id' => $this->dean()->id, 'coordinator_id' => $this->dean()->id, 'message' => 'x']);
        Sanctum::actingAs($coordinator);
        $this->postJson("/api/coordinator/feedback/{$other->id}/read")->assertNotFound();
        Sanctum::actingAs($this->user('intern@internova.test'));
        $this->getJson('/api/coordinator/feedback')->assertForbidden();
    }

    public function test_interns_list_filters_and_flags(): void
    {
        Sanctum::actingAs($this->dean());

        $all = $this->getJson('/api/dean/interns')->assertOk();
        $this->assertCount(1, $all->json('interns'));
        $row = $all->json('interns.0');
        $this->assertSame('Rina Santos', $row['intern_name']);
        $this->assertSame('ABC Technologies', $row['company_name']);
        $this->assertSame('Jose Dela Cruz', $row['supervisor_name']);
        $this->assertSame(480, $row['required_hours']);
        $this->assertGreaterThan(0, $row['narrative_total']);
        $this->assertTrue($row['needs_attention']);
        $this->assertArrayNotHasKey('_created_at', $row);

        $this->getJson('/api/dean/interns?search=rina')->assertJsonCount(1, 'interns');
        $this->getJson('/api/dean/interns?search=zzz')->assertJsonCount(0, 'interns');
        $this->getJson('/api/dean/interns?status=completed')->assertJsonCount(0, 'interns');
        $this->getJson('/api/dean/interns?status=active')->assertJsonCount(1, 'interns');
        $this->getJson('/api/dean/interns?attention=1')->assertJsonCount(1, 'interns');
        $this->getJson('/api/dean/interns?company_id=999999')->assertJsonCount(0, 'interns');

        $this->deployment()->update(['start_date' => now()->toDateString(), 'end_date' => now()->addMonths(3)->toDateString()]);
        $this->getJson('/api/dean/interns?attention=1')->assertJsonCount(0, 'interns');
    }

    public function test_intern_list_uses_a_fixed_number_of_queries(): void
    {
        $base = $this->deployment();
        for ($i = 0; $i < 5; $i++) {
            $u = User::create(['name' => "Intern {$i}", 'email' => "i{$i}@internova.test", 'password' => bcrypt('x'), 'role_id' => $base->intern->role_id, 'school_id' => $base->school_id, 'first_name' => 'In', 'last_name' => "T{$i}", 'status' => 'active']);
            InternshipDeployment::create(['school_id' => $base->school_id, 'intern_id' => $u->id, 'company_id' => $base->company_id, 'supervisor_id' => $base->supervisor_id, 'start_date' => now()->subMonth(), 'end_date' => now()->addMonths(2), 'required_hours' => 480, 'status' => 'active']);
        }
        Sanctum::actingAs($this->dean());

        $this->getJson('/api/dean/interns')->assertOk()->assertJsonCount(6, 'interns'); // warm up
        \DB::flushQueryLog();
        \DB::enableQueryLog();
        $this->getJson('/api/dean/interns')->assertOk();
        $this->assertLessThan(30, count(\DB::getQueryLog()));
    }

    public function test_intern_detail_and_narrative_docx_for_the_dean(): void
    {
        $d = $this->deployment();
        $this->pendingDocument(1);
        Sanctum::actingAs($this->dean());

        $res = $this->getJson("/api/dean/interns/{$d->id}")->assertOk();
        $res->assertJsonPath('intern.intern_name', 'Rina Santos')
            ->assertJsonPath('summary.tasks_total', 1)
            ->assertJsonCount(1, 'documents')
            ->assertJsonCount(1, 'tasks');
        $this->assertArrayHasKey('attendance', $res->json());

        $this->getJson("/api/dean/interns/{$d->id}/narrative-report")->assertOk()->assertJsonPath('student.name', 'Rina Santos');
        $docx = $this->get("/api/dean/interns/{$d->id}/narrative-report/docx");
        $docx->assertOk();
        $this->assertStringContainsString('wordprocessingml', $docx->headers->get('Content-Type'));
    }

    public function test_another_schools_dean_gets_404_and_other_roles_get_403(): void
    {
        $d = $this->deployment();
        Sanctum::actingAs($this->otherSchoolDean());
        $this->getJson("/api/dean/interns/{$d->id}")->assertNotFound();
        $this->getJson("/api/dean/interns/{$d->id}/narrative-report")->assertNotFound();
        $this->getJson("/api/dean/interns/{$d->id}/narrative-report/docx")->assertNotFound();
        $this->getJson('/api/dean/interns')->assertOk()->assertJsonCount(0, 'interns');
        $this->getJson('/api/dean/coordinator/activity')->assertOk()->assertJsonCount(0, 'items');
        $this->postJson('/api/dean/coordinator/feedback', ['message' => 'hi'])->assertStatus(422);

        foreach (['coordinator@internova.test', 'supervisor@internova.test', 'intern@internova.test'] as $email) {
            Sanctum::actingAs($this->user($email));
            $this->getJson('/api/dean/overview')->assertForbidden();
            $this->getJson('/api/dean/interns')->assertForbidden();
            $this->getJson("/api/dean/interns/{$d->id}")->assertForbidden();
            $this->postJson('/api/dean/coordinator/feedback', ['message' => 'hi'])->assertForbidden();
        }
    }
}
