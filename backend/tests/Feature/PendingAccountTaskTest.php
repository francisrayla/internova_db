<?php

namespace Tests\Feature;

use App\Mail\AccountInvitation;
use App\Models\InternshipDeployment;
use App\Models\Role;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Subtasks always have a member; interns who never set up their account stay out of tasks and sit
 * on the coordinator's pending screen, where a wrong email is corrected and a new link is sent.
 */
class PendingAccountTaskTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;
    private User $coordinator;
    private InternshipDeployment $ready;
    private InternshipDeployment $second;
    private InternshipDeployment $pending;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->ready = InternshipDeployment::visibleToSupervisor($this->sup)->firstOrFail();
        InternshipDeployment::visibleToSupervisor($this->sup)->where('id', '!=', $this->ready->id)->each(fn ($d) => $d->update(['status' => 'inactive']));

        $this->second = $this->makeIntern('Ana', 'active');
        $this->pending = $this->makeIntern('Pia', 'pending_activation');
        Task::query()->delete();
    }

    private function makeIntern(string $name, string $status): InternshipDeployment
    {
        $intern = User::create([
            'name' => "$name Cruz", 'first_name' => $name, 'last_name' => 'Cruz', 'email' => strtolower($name) . '@internova.test',
            'password' => $status === 'active' ? bcrypt('password') : null,
            'role_id' => Role::where('name', 'intern')->value('id'), 'school_id' => $this->ready->school_id, 'status' => $status,
            'email_verified_at' => $status === 'active' ? now() : null,
            'invitation_token' => $status === 'active' ? null : hash('sha256', 'old'), 'invitation_expires_at' => $status === 'active' ? null : now()->subDay(),
        ]);

        return InternshipDeployment::create([
            'school_id' => $this->ready->school_id, 'intern_id' => $intern->id, 'company_id' => $this->ready->company_id, 'coordinator_id' => $this->ready->coordinator_id,
            'start_date' => '2026-07-13', 'required_hours' => 486, 'status' => 'active',
        ]);
    }

    private function groupTask(): Task
    {
        Sanctum::actingAs($this->sup);
        $id = $this->postJson('/api/supervisor/tasks', [
            'title' => 'Shared job', 'priority' => 'medium',
            'deployment_ids' => [$this->ready->id, $this->second->id], 'leader_id' => $this->ready->intern_id,
        ])->assertOk()->json('id');

        return Task::findOrFail($id);
    }

    public function test_a_subtask_in_a_group_needs_at_least_one_member(): void
    {
        $task = $this->groupTask();

        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'Part one'])
            ->assertStatus(422)->assertJsonPath('errors.assignee_ids.0', 'Choose at least one member.');
        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'Part one', 'assignee_ids' => []])->assertStatus(422);
        $this->assertSame(0, $task->subtasks()->count());

        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'Part one', 'assignee_ids' => [$this->second->intern_id]])->assertOk();
        $this->assertSame([$this->second->intern_id], $task->subtasks()->first()->assignees()->pluck('users.id')->all());
    }

    public function test_the_task_leader_cannot_add_an_unassigned_subtask_either(): void
    {
        $task = $this->groupTask();
        Sanctum::actingAs(User::findOrFail($this->ready->intern_id));

        $this->postJson("/api/intern/tasks/{$task->id}/subtasks", ['title' => 'Part'])->assertStatus(422);
        $this->postJson("/api/intern/tasks/{$task->id}/subtasks", ['title' => 'Part', 'assignee_ids' => [$this->ready->intern_id, $this->second->intern_id]])->assertOk();
    }

    public function test_a_solo_task_gives_its_subtask_to_the_one_intern(): void
    {
        Sanctum::actingAs($this->sup);
        $id = $this->postJson('/api/supervisor/tasks', ['title' => 'Solo', 'priority' => 'low', 'deployment_ids' => [$this->ready->id]])->assertOk()->json('id');
        $this->postJson("/api/supervisor/tasks/{$id}/subtasks", ['title' => 'Step'])->assertOk();

        $this->assertSame([$this->ready->intern_id], Task::find($id)->subtasks()->first()->assignees()->pluck('users.id')->all());
    }

    public function test_an_intern_without_an_account_is_left_out_of_tasks(): void
    {
        Sanctum::actingAs($this->sup);

        $r = $this->getJson('/api/supervisor/tasks')->assertOk();
        $this->assertEqualsCanonicalizing([$this->ready->id, $this->second->id], collect($r->json('interns'))->pluck('deployment_id')->all());
        $this->assertSame(['Pia Cruz'], $r->json('not_set_up'));

        $this->postJson('/api/supervisor/tasks', ['title' => 'Nope', 'priority' => 'low', 'deployment_ids' => [$this->pending->id]])
            ->assertStatus(422)->assertJsonPath('success', false);
        $this->postJson('/api/supervisor/tasks', [
            'title' => 'Nope', 'priority' => 'low', 'deployment_ids' => [$this->ready->id, $this->pending->id], 'leader_id' => $this->ready->intern_id,
        ])->assertStatus(422);
        $this->assertSame(0, Task::count());
    }

    public function test_the_coordinator_sees_pending_accounts_and_fixes_the_email(): void
    {
        Sanctum::actingAs($this->coordinator);

        $row = collect($this->getJson('/api/coordinator/interns')->assertOk()->json('interns'))->firstWhere('deployment_id', $this->pending->id);
        $this->assertSame('invitation_pending', $row['display_status']);
        $this->assertTrue($row['invitation_expired']);
        $this->assertSame('pia@internova.test', $row['intern_email']);

        $this->patchJson("/api/coordinator/users/{$this->pending->intern_id}/email", ['email' => 'pia.correct@gmail.com'])->assertOk();

        $user = User::findOrFail($this->pending->intern_id);
        $this->assertSame('pia.correct@gmail.com', $user->email);
        $this->assertNotSame(hash('sha256', 'old'), $user->invitation_token); // a new link replaced the old one
        $this->assertTrue(\Illuminate\Support\Carbon::parse($user->invitation_expires_at)->isFuture());
        Mail::assertQueued(AccountInvitation::class, fn ($m) => $m->hasTo('pia.correct@gmail.com'));

        // Once they have an account the email is theirs to change.
        $this->patchJson("/api/coordinator/users/{$this->second->intern_id}/email", ['email' => 'x@gmail.com'])->assertStatus(422);
    }
}
