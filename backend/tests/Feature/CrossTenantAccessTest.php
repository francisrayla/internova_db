<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\DeanFeedback;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\GroupConversation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Message;
use App\Models\Portfolio;
use App\Models\PortfolioItem;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\SupportTicket;
use App\Models\Subtask;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * Black-box sweep of the "who may touch this record" rules. School A (seeded) owns every record; the
 * callers are people from ANOTHER school, from another company of the same school, interns who are not on
 * the task, and users of the wrong role. Each call must be refused (403/404) and must change nothing.
 */
class CrossTenantAccessTest extends TestCase
{
    use BuildsTenants, RefreshDatabase;

    private array $b;               // school B (other school)
    private User $coordA;
    private User $deanA;
    private User $supA;
    private User $supC;             // school A, but a different company
    private User $internA;
    private User $internA2;         // school A, other intern
    private User $pendingSup;
    private User $pendingIntern;
    private InternshipDeployment $depA;
    private InternshipDeployment $depA2;
    private Company $companyA;
    private Company $companyC;
    private Task $taskA;
    private Task $taskA2;
    private Subtask $subA;
    private Attendance $attA;
    private DailyActivity $actA;
    private Document $docA;
    private Evaluation $evalA;
    private SupportTicket $ticketA;
    private DeanFeedback $fbA;
    private PortfolioItem $itemA;
    private GroupConversation $groupA;
    private Message $msgA;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->b = $this->makeOtherSchool('other');

        $this->coordA = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->deanA = User::where('email', 'dean@internova.test')->firstOrFail();
        $this->supA = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->internA = User::where('email', 'intern@internova.test')->firstOrFail();
        $this->depA = InternshipDeployment::firstOrFail();
        $this->companyA = Company::findOrFail($this->depA->company_id);
        $this->taskA = Task::firstOrFail();

        // A second company in school A with its own supervisor and intern.
        $this->companyC = Company::create(['school_id' => $this->depA->school_id, 'company_code' => 'CMP-C', 'company_name' => 'Company C', 'status' => 'active', 'allowed_radius_meters' => 200]);
        $this->supC = $this->makeUser('supervisor', 'supc@internova.test', $this->depA->school_id);
        SupervisorProfile::create(['user_id' => $this->supC->id, 'school_id' => $this->depA->school_id, 'company_id' => $this->companyC->id]);
        $this->internA2 = $this->makeUser('intern', 'intern2@internova.test', $this->depA->school_id);
        InternProfile::create(['user_id' => $this->internA2->id, 'school_id' => $this->depA->school_id, 'student_number' => '20240002', 'course' => 'BS IT', 'year_level' => '4th Year', 'required_hours' => 480]);
        $this->depA2 = InternshipDeployment::create(['school_id' => $this->depA->school_id, 'intern_id' => $this->internA2->id, 'company_id' => $this->companyC->id, 'coordinator_id' => $this->coordA->id, 'start_date' => now()->subMonth()->toDateString(), 'end_date' => now()->addMonths(2)->toDateString(), 'required_hours' => 480, 'status' => 'active']);
        $this->taskA2 = Task::create(['company_id' => $this->companyC->id, 'assigned_by' => $this->supC->id, 'title' => 'C task', 'priority' => 'low', 'status' => 'pending']);
        TaskAssignee::create(['task_id' => $this->taskA2->id, 'deployment_id' => $this->depA2->id, 'user_id' => $this->internA2->id]);

        // Pending (not yet activated) accounts of school A.
        $this->pendingSup = $this->makeUser('supervisor', 'pendsup@internova.test', $this->depA->school_id, 'pending_activation');
        SupervisorProfile::create(['user_id' => $this->pendingSup->id, 'school_id' => $this->depA->school_id, 'company_id' => $this->companyA->id]);
        $this->pendingIntern = $this->makeUser('intern', 'pendint@internova.test', $this->depA->school_id, 'pending_activation');

        // School A's records.
        $this->subA = Subtask::create(['task_id' => $this->taskA->id, 'title' => 'Sub', 'status' => 'pending']);
        TaskComment::create(['task_id' => $this->taskA->id, 'user_id' => $this->supA->id, 'comment' => 'hello']);
        $this->attA = Attendance::create(['deployment_id' => $this->depA->id, 'attendance_date' => '2026-05-04', 'clock_in' => '2026-05-04 00:00:00', 'clock_out' => '2026-05-04 09:00:00', 'status' => 'approved']);
        $this->actA = DailyActivity::create(['deployment_id' => $this->depA->id, 'activity_date' => '2026-05-04', 'title' => 'Did things', 'description' => 'x', 'status' => 'pending']);
        $this->docA = Document::create(['deployment_id' => $this->depA->id, 'uploaded_by' => $this->internA->id, 'document_type' => 'Resume', 'file_name' => 'r.pdf', 'file_path' => 'documents/1/r.pdf', 'status' => 'pending']);
        $this->evalA = Evaluation::create(['deployment_id' => $this->depA->id, 'evaluator_id' => $this->supA->id, 'evaluation_date' => '2026-05-04', 'overall_score' => 90, 'status' => 'submitted']);
        $this->ticketA = SupportTicket::create(['school_id' => $this->coordA->school_id, 'coordinator_id' => $this->coordA->id, 'subject' => 'Help', 'category' => 'General', 'status' => 'Open']);
        $this->ticketA->messages()->create(['sender_id' => $this->coordA->id, 'message' => 'help me']);
        $this->fbA = DeanFeedback::create(['school_id' => $this->coordA->school_id, 'dean_id' => $this->deanA->id, 'coordinator_id' => $this->coordA->id, 'message' => 'Fix this', 'status' => 'open']);
        $portfolio = Portfolio::create(['intern_id' => $this->internA->id, 'school_id' => $this->internA->school_id, 'title' => 'P']);
        $this->itemA = PortfolioItem::create(['portfolio_id' => $portfolio->id, 'title' => 'Item']);
        $this->groupA = GroupConversation::create(['name' => 'A group', 'created_by' => $this->coordA->id, 'school_id' => $this->coordA->school_id]);
        foreach ([$this->coordA, $this->supA, $this->internA] as $u) {
            $this->groupA->members()->create(['user_id' => $u->id]);
        }
        $this->msgA = Message::create(['sender_id' => $this->coordA->id, 'receiver_id' => $this->internA->id, 'school_id' => $this->coordA->school_id, 'message' => 'private note']);
    }

    private function makeUser(string $role, string $email, int $schoolId, string $status = 'active'): User
    {
        return User::create([
            'name' => $email, 'email' => $email, 'password' => bcrypt('password'), 'role_id' => Role::where('name', $role)->value('id'),
            'school_id' => $schoolId, 'first_name' => ucfirst($role), 'last_name' => 'X', 'status' => $status, 'email_verified_at' => now(),
        ]);
    }

    /** @return array<string, array{0: string, 1: string, 2: string, 3: array}> label => [actor, method, url, payload] */
    private function attacks(): array
    {
        $dep = $this->depA->id;
        $c = $this->companyA->id;
        $t = $this->taskA->id;
        $s = $this->subA->id;
        $other = $this->b;

        return [
            // ---- coordinator of another school -------------------------------------------------
            'coord: portfolio' => ['coordB', 'GET', "/api/coordinator/interns/$dep/portfolio", []],
            'coord: report' => ['coordB', 'GET', "/api/coordinator/interns/$dep/report", []],
            'coord: narrative' => ['coordB', 'GET', "/api/coordinator/interns/$dep/narrative-report", []],
            'coord: narrative docx' => ['coordB', 'GET', "/api/coordinator/interns/$dep/narrative-report/docx", []],
            'coord: edit deployment' => ['coordB', 'PATCH', "/api/coordinator/interns/$dep", ['end_date' => '2030-01-01']],
            'coord: status' => ['coordB', 'PATCH', "/api/coordinator/interns/$dep/status", ['status' => 'inactive']],
            'coord: delete intern' => ['coordB', 'DELETE', "/api/coordinator/interns/$dep", []],
            'coord: reassign' => ['coordB', 'POST', "/api/coordinator/interns/$dep/reassign", ['company_id' => $other['company']->id]],
            'coord: company show' => ['coordB', 'GET', "/api/coordinator/companies/$c", []],
            'coord: company edit' => ['coordB', 'PATCH', "/api/coordinator/companies/$c", ['company_name' => 'Hacked']],
            'coord: company delete' => ['coordB', 'DELETE', "/api/coordinator/companies/$c", []],
            'coord: edit supervisor' => ['coordB', 'PATCH', "/api/coordinator/supervisors/{$this->pendingSup->id}", ['first_name' => 'Hacked']],
            'coord: delete supervisor' => ['coordB', 'DELETE', "/api/coordinator/supervisors/{$this->supA->id}", []],
            'coord: resend invitation' => ['coordB', 'POST', "/api/coordinator/users/{$this->pendingIntern->id}/resend-invitation", []],
            'coord: change pending email' => ['coordB', 'PATCH', "/api/coordinator/users/{$this->pendingIntern->id}/email", ['email' => 'steal@example.com']],
            'coord: task show' => ['coordB', 'GET', "/api/coordinator/tasks/$t", []],
            'coord: task comment' => ['coordB', 'POST', "/api/coordinator/tasks/$t/comments", ['comment' => 'x']],
            'coord: subtask comment' => ['coordB', 'POST', "/api/coordinator/subtasks/$s/comments", ['comment' => 'x']],
            'coord: review document' => ['coordB', 'PATCH', "/api/coordinator/documents/{$this->docA->id}", ['status' => 'approved']],
            'coord: ticket show' => ['coordB', 'GET', "/api/coordinator/support-tickets/{$this->ticketA->id}", []],
            'coord: ticket reply' => ['coordB', 'POST', "/api/coordinator/support-tickets/{$this->ticketA->id}/reply", ['message' => 'x']],
            'coord: feedback read' => ['coordB', 'POST', "/api/coordinator/feedback/{$this->fbA->id}/read", []],
            'coord: feedback ack' => ['coordB', 'POST', "/api/coordinator/feedback/{$this->fbA->id}/acknowledge", []],
            'coord: feedback reply' => ['coordB', 'POST', "/api/coordinator/feedback/{$this->fbA->id}/reply", ['message' => 'x']],
            'coord: add intern to a company of another school' => ['coordB', 'POST', '/api/coordinator/interns', [
                'first_name' => 'Evil', 'last_name' => 'Intern', 'email' => 'evil.intern@example.com', 'student_number' => '999', 'course' => 'BSIT',
                'company_id' => $c, 'start_date' => now()->toDateString(), 'end_date' => now()->addMonths(3)->toDateString(),
            ]],
            'coord: add supervisor to a company of another school' => ['coordB', 'POST', '/api/coordinator/supervisors', [
                'first_name' => 'Evil', 'last_name' => 'Sup', 'email' => 'evil.sup@example.com', 'company_id' => $c,
            ]],

            // ---- dean of another school -----------------------------------------------------
            'dean: intern detail' => ['deanB', 'GET', "/api/dean/interns/$dep", []],
            'dean: narrative' => ['deanB', 'GET', "/api/dean/interns/$dep/narrative-report", []],
            'dean: narrative docx' => ['deanB', 'GET', "/api/dean/interns/$dep/narrative-report/docx", []],
            'dean: feedback reply' => ['deanB', 'POST', "/api/dean/coordinator/feedback/{$this->fbA->id}/reply", ['message' => 'x']],
            'dean: feedback resolve' => ['deanB', 'POST', "/api/dean/coordinator/feedback/{$this->fbA->id}/resolve", []],
            'dean: feedback reopen' => ['deanB', 'POST', "/api/dean/coordinator/feedback/{$this->fbA->id}/reopen", []],
            'dean: ticket show' => ['deanB', 'GET', "/api/dean/support-tickets/{$this->ticketA->id}", []],
            'dean: ticket reply' => ['deanB', 'POST', "/api/dean/support-tickets/{$this->ticketA->id}/reply", ['message' => 'x']],
            'dean: other school checkout' => ['deanB', 'POST', "/api/dean/schools/{$this->deanA->school_id}/checkout", []],
            'dean: other school upgrade quote' => ['deanB', 'GET', "/api/dean/schools/{$this->deanA->school_id}/upgrade-quote", []],
            'dean: other school switch plan' => ['deanB', 'POST', "/api/dean/schools/{$this->deanA->school_id}/switch-plan", []],
            'dean: other school plan change' => ['deanB', 'POST', "/api/dean/schools/{$this->deanA->school_id}/request-plan-change", []],
            'dean: other school upload proof' => ['deanB', 'POST', "/api/dean/schools/{$this->deanA->school_id}/upload-proof", []],

            // ---- supervisor of another school / of another company in the same school ---------
            ...$this->supervisorAttacks('supB'),
            ...$this->supervisorAttacks('supC'),

            // ---- interns who are not on the record ---------------------------------------------
            ...$this->internAttacks('internB'),
            ...$this->internAttacks('internA2'),

            // ---- chat ----------------------------------------------------------------------------
            'chat: read a thread of another school' => ['coordB', 'GET', "/api/messages/thread/{$this->internA->id}", []],
            'chat: message someone of another school' => ['coordB', 'POST', '/api/messages', ['receiver_id' => $this->internA->id, 'message' => 'hi']],
            'chat: typing to someone of another school' => ['coordB', 'POST', '/api/messages/typing', ['receiver_id' => $this->internA->id]],
            'chat: read a group' => ['coordB', 'GET', "/api/messages/groups/{$this->groupA->id}", []],
            'chat: post in a group' => ['coordB', 'POST', "/api/messages/groups/{$this->groupA->id}/messages", ['message' => 'x']],
            'chat: group typing' => ['coordB', 'POST', "/api/messages/groups/{$this->groupA->id}/typing", []],
            'chat: forward a private message' => ['coordB', 'POST', '/api/messages/forward', ['source_type' => 'dm', 'source_id' => $this->msgA->id, 'target_type' => 'dm', 'target_id' => $other['intern']->id]],
            'chat: settings on a foreign group' => ['coordB', 'PATCH', '/api/messages/settings', ['type' => 'group', 'id' => $this->groupA->id, 'muted' => true]],
            'chat: create group with foreign people' => ['coordB', 'POST', '/api/messages/groups', ['member_ids' => [$this->internA->id, $this->supA->id]]],
            'chat: same-school intern reads a group they are not in' => ['internA2', 'GET', "/api/messages/groups/{$this->groupA->id}", []],
            'chat: other-company intern reads a thread' => ['internA2', 'GET', "/api/messages/thread/{$this->internA->id}", []],

            // ---- wrong role (same school) ------------------------------------------------------
            'role: intern uses coordinator api' => ['internA', 'GET', '/api/coordinator/interns', []],
            'role: intern uses supervisor api' => ['internA', 'GET', '/api/supervisor/interns', []],
            'role: intern uses dean api' => ['internA', 'GET', '/api/dean/interns', []],
            'role: intern uses superadmin api' => ['internA', 'GET', '/api/superadmin/schools', []],
            'role: supervisor uses coordinator api' => ['supA', 'GET', '/api/coordinator/interns', []],
            'role: supervisor edits an intern' => ['supA', 'PATCH', "/api/coordinator/interns/{$this->depA->id}", ['end_date' => '2030-01-01']],
            'role: supervisor uses dean api' => ['supA', 'GET', '/api/dean/overview', []],
            'role: supervisor uses superadmin api' => ['supA', 'GET', '/api/superadmin/dashboard', []],
            'role: coordinator uses supervisor api' => ['coordA', 'GET', '/api/supervisor/interns', []],
            'role: coordinator uses intern api' => ['coordA', 'GET', '/api/intern/tasks', []],
            'role: coordinator uses dean api' => ['coordA', 'GET', '/api/dean/overview', []],
            'role: coordinator uses dean billing' => ['coordA', 'POST', "/api/dean/schools/{$this->coordA->school_id}/checkout", []],
            'role: coordinator uses superadmin api' => ['coordA', 'GET', '/api/superadmin/schools', []],
            'role: coordinator toggles school suspension' => ['coordA', 'POST', "/api/superadmin/schools/{$this->coordA->school_id}/toggle-suspend", []],
            'role: dean uses coordinator api' => ['deanA', 'GET', '/api/coordinator/interns', []],
            'role: dean uses supervisor api' => ['deanA', 'GET', '/api/supervisor/interns', []],
            'role: dean uses superadmin api' => ['deanA', 'GET', '/api/superadmin/schools', []],
            'role: dean changes a system setting' => ['deanA', 'PATCH', '/api/superadmin/system-settings/maintenance_mode', ['value' => '1']],
            'role: intern reads a superadmin ticket' => ['internA', 'GET', "/api/superadmin/support-messages/{$this->ticketA->id}", []],
            'role: dean reads a superadmin ticket' => ['deanA', 'GET', "/api/superadmin/support-messages/{$this->ticketA->id}", []],
        ];
    }

    private function supervisorAttacks(string $who): array
    {
        $dep = $this->depA->id;
        $t = $this->taskA->id;
        $p = "$who: ";

        return [
            $p.'portfolio' => [$who, 'GET', "/api/supervisor/interns/$dep/portfolio", []],
            $p.'log attendance' => [$who, 'POST', '/api/supervisor/attendance', ['deployment_id' => $dep, 'attendance_date' => '2026-05-05', 'clock_in' => '08:00', 'clock_out' => '17:00']],
            $p.'review attendance' => [$who, 'PATCH', "/api/supervisor/attendance/{$this->attA->id}", ['status' => 'rejected']],
            $p.'edit attendance times' => [$who, 'PATCH', "/api/supervisor/attendance/{$this->attA->id}/times", ['clock_in' => '09:00', 'clock_out' => '10:00']],
            $p.'delete attendance' => [$who, 'DELETE', "/api/supervisor/attendance/{$this->attA->id}", []],
            $p.'check red flag' => [$who, 'PATCH', "/api/supervisor/attendance/{$this->attA->id}/red-flag", []],
            $p.'review activity' => [$who, 'PATCH', "/api/supervisor/activities/{$this->actA->id}", ['status' => 'approved']],
            $p.'approve activities' => [$who, 'POST', '/api/supervisor/activities/approve', ['ids' => [$this->actA->id]]],
            $p.'task show' => [$who, 'GET', "/api/supervisor/tasks/$t", []],
            $p.'task edit' => [$who, 'PATCH', "/api/supervisor/tasks/$t", ['title' => 'Hacked', 'priority' => 'low']],
            $p.'task rate' => [$who, 'POST', "/api/supervisor/tasks/$t/evaluate", ['rating' => 5, 'score' => 5, 'remarks' => 'x']],
            $p.'add subtask' => [$who, 'POST', "/api/supervisor/tasks/$t/subtasks", ['title' => 'Injected']],
            $p.'delete subtask' => [$who, 'DELETE', "/api/supervisor/subtasks/{$this->subA->id}", []],
            $p.'task comment' => [$who, 'POST', "/api/supervisor/tasks/$t/comments", ['comment' => 'x']],
            $p.'subtask comment' => [$who, 'POST', "/api/supervisor/subtasks/{$this->subA->id}/comments", ['comment' => 'x']],
            $p.'assign a task to a foreign intern' => [$who, 'POST', '/api/supervisor/tasks', ['deployment_ids' => [$dep], 'title' => 'Mine now', 'priority' => 'low']],
            $p.'evaluate a foreign intern' => [$who, 'POST', '/api/supervisor/evaluations/manual', ['deployment_id' => $dep, 'evaluation_date' => '2026-05-06', 'overall_score' => 50]],
            $p.'edit a foreign evaluation' => [$who, 'PATCH', "/api/supervisor/evaluations/{$this->evalA->id}", ['overall_score' => 10, 'evaluation_date' => '2026-05-06']],
            $p.'certificate for a foreign intern' => [$who, 'POST', '/api/supervisor/certificates/generate', ['deployment_id' => $dep, 'name' => 'Rina Santos']],
        ];
    }

    private function internAttacks(string $who): array
    {
        $t = $this->taskA->id;
        $s = $this->subA->id;
        $p = "$who: ";

        return [
            $p.'task show' => [$who, 'GET', "/api/intern/tasks/$t", []],
            $p.'task edit' => [$who, 'PATCH', "/api/intern/tasks/$t", ['status' => 'completed']],
            $p.'task complete' => [$who, 'POST', "/api/intern/tasks/$t/complete", []],
            $p.'add subtask' => [$who, 'POST', "/api/intern/tasks/$t/subtasks", ['title' => 'Injected']],
            $p.'edit subtask' => [$who, 'PATCH', "/api/intern/subtasks/$s", ['status' => 'completed']],
            $p.'complete subtask' => [$who, 'POST', "/api/intern/subtasks/$s/complete", []],
            $p.'task comment' => [$who, 'POST', "/api/intern/tasks/$t/comments", ['comment' => 'x']],
            $p.'subtask comment' => [$who, 'POST', "/api/intern/subtasks/$s/comments", ['comment' => 'x']],
            $p.'edit activity' => [$who, 'PATCH', "/api/intern/activities/{$this->actA->id}", ['title' => 'Hacked', 'description' => 'x']],
            $p.'delete portfolio item' => [$who, 'DELETE', "/api/intern/portfolio/items/{$this->itemA->id}", []],
        ];
    }

    private function actor(string $key): User
    {
        return match ($key) {
            'coordB' => $this->b['coordinator'], 'deanB' => $this->b['dean'], 'supB' => $this->b['supervisor'], 'internB' => $this->b['intern'],
            'coordA' => $this->coordA, 'deanA' => $this->deanA, 'supA' => $this->supA, 'internA' => $this->internA,
            'supC' => $this->supC, 'internA2' => $this->internA2,
        };
    }

    public function test_no_record_of_school_a_is_reachable_by_outsiders(): void
    {
        $holes = [];
        $report = [];
        foreach ($this->attacks() as $label => [$actor, $method, $url, $payload]) {
            Sanctum::actingAs($this->actor($actor));
            $res = $this->json($method, $url, $payload);
            $status = $res->status();
            $report[] = sprintf('%-3d %-55s %s %s %s', $status, $label, $method, $url, $status === 422 ? substr((string) $res->getContent(), 0, 220) : '');
            if ($status < 400) {
                $holes[] = "$status $label  ($method $url)";
            }
        }

        $dump = getenv('IDOR_DUMP');
        if ($dump) {
            file_put_contents($dump, implode("\n", $report)."\n");
        }
        $this->assertSame([], $holes, "Reachable by someone who must not reach it:\n".implode("\n", $holes));

        // ...and nothing was changed on the way.
        $this->assertSame('pending', $this->actA->fresh()->status);
        $this->assertSame('approved', $this->attA->fresh()->status);
        $this->assertSame('pending', $this->docA->fresh()->status);
        $this->assertEquals(90, $this->evalA->fresh()->overall_score);
        $this->assertSame('Prepare onboarding checklist', $this->taskA->fresh()->title);
        $this->assertSame(1, $this->taskA->subtasks()->count());
        $this->assertSame(1, $this->taskA->comments()->count());
        $this->assertSame($this->companyA->company_name, $this->companyA->fresh()->company_name);
        $this->assertSame('active', $this->depA->fresh()->status);
        $this->assertSame($this->depA->end_date->toDateString(), $this->depA->fresh()->end_date->toDateString());
        $this->assertSame(1, InternshipDeployment::where('company_id', $this->companyA->id)->count());
        $this->assertSame(0, User::where('email', 'like', 'evil.%')->count());
        $this->assertSame(0, Task::where('title', 'Mine now')->count());
        $this->assertSame('pendint@internova.test', $this->pendingIntern->fresh()->email);
        $this->assertSame(3, $this->groupA->members()->count());
        $this->assertSame(0, $this->groupA->messages()->count());
        $this->assertNull($this->fbA->fresh()->resolved_at);
        $this->assertSame('Open', $this->ticketA->fresh()->status);
        $this->assertSame(1, $this->ticketA->messages()->count());
        $this->assertSame(1, Message::count());
        $this->assertTrue($this->supA->fresh()->exists);
        $this->assertSame('Sub', $this->subA->fresh()->title);
        $this->assertSame('pending', $this->subA->fresh()->status);
        $this->assertSame('Did things', $this->actA->fresh()->title);
    }
}
