<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A task given to more than one intern needs a leader: the one who submits the parent task.
 */
class GroupTaskLeaderTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;
    /** @var \Illuminate\Support\Collection<int, InternshipDeployment> */
    private $deps;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $first = InternshipDeployment::visibleToSupervisor($this->sup)->firstOrFail();
        $this->deps = collect([$first]);
        foreach (['Ana', 'Ben'] as $name) {
            $intern = User::create([
                'name' => "$name Cruz", 'first_name' => $name, 'last_name' => 'Cruz', 'email' => strtolower($name) . '@internova.test', 'password' => bcrypt('password'),
                'role_id' => \App\Models\Role::where('name', 'intern')->value('id'), 'school_id' => $first->school_id, 'status' => 'active', 'email_verified_at' => now(),
            ]);
            $this->deps->push(InternshipDeployment::create([
                'school_id' => $first->school_id, 'intern_id' => $intern->id, 'company_id' => $first->company_id, 'coordinator_id' => $first->coordinator_id,
                'start_date' => '2026-07-13', 'required_hours' => 486, 'status' => 'active',
            ]));
        }
        Task::query()->delete();
    }

    private function create(array $payload)
    {
        Sanctum::actingAs($this->sup);

        return $this->postJson('/api/supervisor/tasks', array_merge(['title' => 'Shared job', 'priority' => 'medium'], $payload));
    }

    public function test_a_group_task_without_a_leader_is_refused(): void
    {
        $this->create(['deployment_ids' => $this->deps->take(2)->pluck('id')->all()])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.leader_id.0', 'Choose a task leader.');

        $this->assertSame(0, Task::count());
    }

    public function test_the_leader_must_be_one_of_the_interns_on_the_task(): void
    {
        $outsider = User::where('email', 'supervisor@internova.test')->value('id'); // a user who is not an assignee
        $this->create(['deployment_ids' => $this->deps->take(2)->pluck('id')->all(), 'leader_id' => $outsider])->assertStatus(422);
        $this->assertSame(0, Task::count());
    }

    public function test_a_group_task_with_a_leader_is_created(): void
    {
        $members = $this->deps->take(2);
        $leader = $members->last()->intern_id;

        $this->create(['deployment_ids' => $members->pluck('id')->all(), 'leader_id' => $leader])->assertOk()->assertJsonPath('success', true);

        $task = Task::firstOrFail();
        $this->assertSame($leader, $task->leader_id);
        $this->assertCount(2, $task->assignees);
    }

    public function test_one_intern_needs_no_leader_and_a_stray_leader_is_ignored(): void
    {
        $one = $this->deps->first();
        $this->create(['deployment_ids' => [$one->id]])->assertOk();
        $this->create(['deployment_ids' => [$one->id], 'leader_id' => $one->intern_id])->assertOk();

        $this->assertSame([null, null], Task::orderBy('id')->pluck('leader_id')->all());
    }

    public function test_a_member_sees_who_the_leader_is_but_a_solo_task_has_none(): void
    {
        $members = $this->deps->take(2);
        $leader = $members->last()->intern_id;
        $this->create(['deployment_ids' => $members->pluck('id')->all(), 'leader_id' => $leader])->assertOk();
        $this->create(['title' => 'Solo', 'deployment_ids' => [$this->deps->last()->id]])->assertOk();
        $group = Task::where('title', 'Shared job')->firstOrFail();
        $solo = Task::where('title', 'Solo')->firstOrFail();

        Sanctum::actingAs(User::findOrFail($members->first()->intern_id));
        $this->getJson("/api/intern/tasks/{$group->id}")->assertOk()
            ->assertJsonPath('task.leader_id', $leader)->assertJsonPath('task.is_leader', false);

        Sanctum::actingAs(User::findOrFail($this->deps->last()->intern_id));
        $this->getJson("/api/intern/tasks/{$solo->id}")->assertOk()->assertJsonPath('task.leader_id', null);
    }

    // ---- choosing or replacing the leader on Edit task ------------------------

    private function groupTask(): Task
    {
        $members = $this->deps->take(3);
        $this->create(['deployment_ids' => $members->pluck('id')->all(), 'leader_id' => $members[1]->intern_id, 'description' => 'Keep me'])->assertOk();

        return Task::firstOrFail();
    }

    private function edit(Task $task, array $payload)
    {
        Sanctum::actingAs($this->sup);

        return $this->patchJson("/api/supervisor/tasks/{$task->id}", array_merge(['title' => $task->title, 'priority' => $task->priority], $payload));
    }

    public function test_the_supervisor_can_replace_the_leader_and_the_interns_are_told(): void
    {
        $task = $this->groupTask();
        $new = $this->deps[2]->intern_id;

        $this->edit($task, ['leader_id' => $new])->assertOk()->assertJsonPath('changed', ['leader_id']);

        $this->assertSame($new, $task->fresh()->leader_id);
        $this->assertSame('Keep me', $task->fresh()->description, 'a field that was not sent is kept');
        $this->assertDatabaseHas('notifications', ['user_id' => $new, 'type' => 'task_updated']);
        $this->assertStringContainsString('is now the task leader', (string) \Illuminate\Support\Facades\DB::table('notifications')->where('user_id', $new)->latest('id')->value('body'));
    }

    public function test_the_new_leader_must_be_an_active_intern_on_the_task(): void
    {
        $task = $this->groupTask();
        $outsider = User::where('email', 'supervisor@internova.test')->value('id');
        $this->edit($task, ['leader_id' => $outsider])->assertStatus(422)->assertJsonPath('errors.leader_id.0', 'The leader must be one of the interns on this task.');

        User::whereKey($this->deps[2]->intern_id)->update(['status' => 'inactive']);
        $this->edit($task, ['leader_id' => $this->deps[2]->intern_id])->assertStatus(422)->assertJsonPath('errors.leader_id.0', 'Choose an active intern.');

        $this->assertSame($this->deps[1]->intern_id, $task->fresh()->leader_id);
    }

    public function test_a_task_without_a_usable_leader_is_flagged_until_one_is_chosen(): void
    {
        $task = $this->groupTask();
        Sanctum::actingAs($this->sup);
        $show = fn () => $this->getJson("/api/supervisor/tasks/{$task->id}")->assertOk()->json('task');

        $this->assertNull($show()['leader_problem']);

        Task::whereKey($task->id)->update(['leader_id' => null]); // a task made before leaders were required
        $this->assertSame('missing', $show()['leader_problem']);

        Task::whereKey($task->id)->update(['leader_id' => $this->deps[1]->intern_id]);
        User::whereKey($this->deps[1]->intern_id)->update(['status' => 'inactive']);
        $this->assertSame('inactive', $show()['leader_problem']);
        $this->assertFalse(collect($show()['assignees'])->firstWhere('user_id', $this->deps[1]->intern_id)['can_lead']);

        $this->edit($task, ['leader_id' => $this->deps[0]->intern_id])->assertOk();
        $this->assertNull($show()['leader_problem']);
        $this->assertNull(collect($this->getJson('/api/supervisor/tasks')->json('tasks'))->firstWhere('id', $task->id)['leader_problem']);
    }

    public function test_a_one_intern_task_never_gets_a_leader(): void
    {
        $this->create(['deployment_ids' => [$this->deps[0]->id]])->assertOk();
        $task = Task::firstOrFail();

        $this->edit($task, ['leader_id' => $this->deps[0]->intern_id])->assertOk();
        $this->assertNull($task->fresh()->leader_id);
    }
}
