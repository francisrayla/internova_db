<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\Task;
use App\Models\TaskEvaluation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A parent task is only done when every subtask is done, a done task is closed to new subtasks,
 * a finished task waits in the Active list until it is rated, and the supervisor can fix a task's
 * details until it is rated.
 */
class TaskCompletionRulesTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;
    private User $intern;
    private User $coordinator;
    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->dep = InternshipDeployment::visibleToSupervisor($this->sup)->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
        Task::query()->delete();
    }

    private function newTask(array $extra = []): Task
    {
        Sanctum::actingAs($this->sup);
        $id = $this->postJson('/api/supervisor/tasks', ['title' => 'Timpla ka kape', 'priority' => 'medium', 'deployment_ids' => [$this->dep->id]] + $extra)
            ->assertOk()->json('id');

        return Task::findOrFail($id);
    }

    private function addSubtask(Task $task, string $title = 'inumin mo'): int
    {
        Sanctum::actingAs($this->sup);

        return $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => $title])->assertOk()->json('id');
    }

    private function proof(): array
    {
        return ['proofs' => [UploadedFile::fake()->image('proof.png')]];
    }

    private function internCompletesTask(Task $task)
    {
        Sanctum::actingAs($this->intern);

        return $this->post("/api/intern/tasks/{$task->id}/complete", $this->proof(), ['Accept' => 'application/json']);
    }

    private function internCompletesSubtask(int $subtaskId)
    {
        Sanctum::actingAs($this->intern);

        return $this->post("/api/intern/subtasks/{$subtaskId}/complete", $this->proof(), ['Accept' => 'application/json']);
    }

    public function test_a_subtask_cannot_be_added_to_a_task_that_is_already_done(): void
    {
        $task = $this->newTask();
        $this->internCompletesTask($task)->assertOk();
        $this->assertSame('completed', $task->fresh()->status);

        // This is how "Timpla ka kape" ended up done with an unfinished subtask: the add used to be accepted.
        Sanctum::actingAs($this->sup);
        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'inumin mo'])
            ->assertStatus(422)->assertJsonPath('success', false);
        Sanctum::actingAs($this->intern);
        $this->postJson("/api/intern/tasks/{$task->id}/subtasks", ['title' => 'inumin mo'])->assertStatus(422);

        $this->assertSame(0, $task->subtasks()->count());
        $this->assertSame('completed', $task->fresh()->status);
    }

    public function test_a_rated_task_is_closed_to_subtasks_edits_and_reopening(): void
    {
        $task = $this->newTask();
        $this->internCompletesTask($task)->assertOk();
        Sanctum::actingAs($this->sup);
        $this->postJson("/api/supervisor/tasks/{$task->id}/evaluate", ['rating' => 3])->assertOk();

        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'late'])
            ->assertStatus(422)->assertJsonFragment(['message' => 'This task has already been rated, so no more subtasks can be added to it.']);
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Changed', 'priority' => 'low'])->assertStatus(422);
        $this->assertSame('Timpla ka kape', $task->fresh()->title);

        Sanctum::actingAs($this->intern);
        $this->patchJson("/api/intern/tasks/{$task->id}", ['status' => 'pending'])->assertStatus(422);
        $this->assertSame('completed', $task->fresh()->status);
    }

    public function test_the_parent_cannot_be_completed_before_its_subtasks(): void
    {
        $task = $this->newTask();
        $subtaskId = $this->addSubtask($task);

        $this->internCompletesTask($task)->assertStatus(422);
        $this->patchJson("/api/intern/tasks/{$task->id}", ['status' => 'completed'])->assertStatus(422);
        $this->assertNotSame('completed', $task->fresh()->status);

        $this->internCompletesSubtask($subtaskId)->assertOk();
        $this->assertNotSame('completed', $task->fresh()->status); // finishing the last subtask does not finish the parent
        $this->internCompletesTask($task)->assertOk();
        $this->assertSame('completed', $task->fresh()->status);
    }

    public function test_the_model_refuses_completed_while_a_subtask_is_open(): void
    {
        $task = $this->newTask();
        $this->addSubtask($task);

        $task->setStatus('completed');

        $this->assertSame('pending', $task->fresh()->status);
    }

    public function test_subtasks_of_a_done_task_cannot_be_moved_back(): void
    {
        $task = $this->newTask();
        $subtaskId = $this->addSubtask($task);
        $this->internCompletesSubtask($subtaskId)->assertOk();
        $this->internCompletesTask($task)->assertOk();

        Sanctum::actingAs($this->intern);
        foreach (['pending', 'in_progress'] as $status) {
            $this->patchJson("/api/intern/subtasks/{$subtaskId}", ['status' => $status])->assertStatus(422);
        }
        $this->assertSame('completed', $task->subtasks()->first()->status);
    }

    public function test_an_old_done_task_with_an_open_subtask_can_be_repaired_but_not_rated_until_then(): void
    {
        // The state production data can already be in: done, with a subtask still pending.
        $task = $this->newTask();
        $open = $this->addSubtask($task, 'still open');
        $removable = $this->addSubtask($task, 'remove me');
        $task->update(['status' => 'completed', 'completed_at' => now()]);

        Sanctum::actingAs($this->sup);
        $this->postJson("/api/supervisor/tasks/{$task->id}/evaluate", ['rating' => 5])->assertStatus(422);

        Sanctum::actingAs($this->intern);
        $this->patchJson("/api/intern/subtasks/{$open}", ['status' => 'in_progress'])->assertStatus(422); // nothing moves back
        $this->internCompletesSubtask($open)->assertOk(); // but it can be finished

        Sanctum::actingAs($this->sup);
        $this->deleteJson("/api/supervisor/subtasks/{$removable}")->assertOk(); // or removed
        $this->postJson("/api/supervisor/tasks/{$task->id}/evaluate", ['rating' => 5])->assertOk();

        // Once rated, a finished subtask is part of what was graded and stays.
        $this->deleteJson('/api/supervisor/subtasks/' . $task->subtasks()->first()->id)->assertStatus(422);
    }

    public function test_a_done_task_waits_in_active_until_it_is_rated(): void
    {
        $task = $this->newTask();
        $this->internCompletesTask($task)->assertOk();

        foreach ([[$this->sup, 'supervisor'], [$this->intern, 'intern'], [$this->coordinator, 'coordinator']] as [$user, $prefix]) {
            Sanctum::actingAs($user);
            $row = collect($this->getJson("/api/{$prefix}/tasks")->assertOk()->json('tasks'))->firstWhere('id', $task->id);
            $this->assertTrue($row['awaiting_rating'], "$prefix should see the task as waiting for a rating");
            $this->assertNull($row['evaluation']);
        }

        Sanctum::actingAs($this->sup);
        $this->postJson("/api/supervisor/tasks/{$task->id}/evaluate", ['rating' => 9])->assertOk();
        $row = collect($this->getJson('/api/supervisor/tasks')->json('tasks'))->firstWhere('id', $task->id);
        $this->assertFalse($row['awaiting_rating']);
        $this->assertEquals(9, $row['evaluation']['rating']);
    }

    public function test_a_plan_without_task_ratings_does_not_leave_done_tasks_waiting_forever(): void
    {
        $subscription = $this->sup->school->currentSubscription();
        $basic = \App\Models\SubscriptionPlan::where('name', 'Basic')->first();
        if (!$basic || in_array(\App\Services\PlanFeatures::TASK_RATINGS, $basic->features ?? [], true)) {
            $this->markTestSkipped('No Basic plan without per-task ratings in this database.');
        }
        $subscription->update(['plan_id' => $basic->id]);

        $task = $this->newTask();
        Sanctum::actingAs($this->intern);
        $this->postJson("/api/intern/tasks/{$task->id}/complete")->assertOk();

        $row = collect($this->getJson('/api/intern/tasks')->json('tasks'))->firstWhere('id', $task->id);
        $this->assertFalse($row['awaiting_rating']);
    }

    public function test_supervisor_edits_a_task_and_the_interns_are_told(): void
    {
        $task = $this->newTask(['description' => 'old', 'due_date' => '2026-10-20']);
        Sanctum::actingAs($this->sup);

        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Timpla ng kape', 'description' => 'new', 'priority' => 'high', 'due_date' => '2026-10-09'])
            ->assertOk()->assertJsonPath('changed', ['title', 'description', 'priority', 'due_date']);

        $fresh = $task->fresh();
        $this->assertSame('Timpla ng kape', $fresh->title);
        $this->assertSame('high', $fresh->priority);
        $this->assertSame('2026-10-09', $fresh->due_date->format('Y-m-d'));
        $this->assertSame(1, Notification::where('user_id', $this->intern->id)->where('type', 'task_updated')->count());
        $this->assertDatabaseHas('activity_logs', ['module' => 'Tasks', 'action' => 'Edited task']);

        // Nothing changed means nothing is sent.
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Timpla ng kape', 'description' => 'new', 'priority' => 'high', 'due_date' => '2026-10-09'])
            ->assertOk()->assertJsonPath('changed', []);
        $this->assertSame(1, Notification::where('user_id', $this->intern->id)->where('type', 'task_updated')->count());

        // The due date and description can be cleared.
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Timpla ng kape', 'description' => '', 'priority' => 'high', 'due_date' => null])->assertOk();
        $this->assertNull($task->fresh()->due_date);
        $this->assertNull($task->fresh()->description);
    }

    public function test_task_edit_is_validated_and_limited_to_the_supervisors_of_that_company(): void
    {
        $task = $this->newTask();

        Sanctum::actingAs($this->sup);
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => '', 'priority' => 'high'])->assertStatus(422)->assertJsonValidationErrors('title');
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'x', 'priority' => 'urgent'])->assertStatus(422)->assertJsonValidationErrors('priority');
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'x', 'priority' => 'low', 'due_date' => 'not a date'])->assertStatus(422)->assertJsonValidationErrors('due_date');

        // A supervisor from another company cannot see it, so it is a 404.
        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $stranger = User::create([
            'name' => 'Ana Reyes', 'email' => 'stranger@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $stranger->id, 'school_id' => $this->dep->school_id, 'company_id' => $other->id]);
        Sanctum::actingAs($stranger);
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'hijack', 'priority' => 'low'])->assertStatus(404);

        // Interns and coordinators have no edit route at all.
        Sanctum::actingAs($this->intern);
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'hijack', 'priority' => 'low'])->assertForbidden();
        Sanctum::actingAs($this->coordinator);
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'hijack', 'priority' => 'low'])->assertForbidden();

        $this->assertSame('Timpla ka kape', $task->fresh()->title);
        $this->assertSame(0, TaskEvaluation::count());
    }
}
