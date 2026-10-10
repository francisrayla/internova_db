<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The coordinator only MONITORS tasks: supervisors assign, edit and rate them. */
class CoordinatorTasksReadOnlyTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_coordinator_can_look_at_tasks_but_cannot_create_edit_rate_or_delete_them(): void
    {
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $dep = InternshipDeployment::firstOrFail();
        $task = Task::create(['company_id' => $dep->company_id, 'assigned_by' => User::where('email', 'supervisor@internova.test')->value('id'), 'title' => 'Filing', 'priority' => 'low', 'status' => 'pending']);
        TaskAssignee::create(['task_id' => $task->id, 'deployment_id' => $dep->id, 'user_id' => $dep->intern_id]);

        $before = Task::count();
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $this->getJson('/api/coordinator/tasks')->assertOk();
        $this->getJson("/api/coordinator/tasks/{$task->id}")->assertOk();

        // No coordinator route creates, edits, rates or deletes a task (405 = the path exists only for reading).
        $this->postJson('/api/coordinator/tasks', ['title' => 'Mine', 'priority' => 'low', 'deployment_ids' => [$dep->id]])->assertStatus(405);
        $this->patchJson("/api/coordinator/tasks/{$task->id}", ['title' => 'Changed'])->assertStatus(405);
        $this->deleteJson("/api/coordinator/tasks/{$task->id}")->assertStatus(405);
        $this->postJson("/api/coordinator/tasks/{$task->id}/evaluate", ['rating' => 9])->assertNotFound();
        $this->postJson("/api/coordinator/tasks/{$task->id}/subtasks", ['title' => 'x'])->assertNotFound();

        // And the supervisor's routes stay closed to the role.
        $this->postJson('/api/supervisor/tasks', ['title' => 'Mine', 'priority' => 'low', 'deployment_ids' => [$dep->id]])->assertForbidden();
        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Changed'])->assertForbidden();

        $this->assertSame($before, Task::count());
        $this->assertSame('Filing', $task->fresh()->title);
    }
}
