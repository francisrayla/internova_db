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
}
