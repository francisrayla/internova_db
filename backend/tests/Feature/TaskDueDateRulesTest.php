<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Task;
use App\Models\User;
use App\Support\LocalTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A supervisor cannot put a task's due date in the past: new tasks/subtasks need today (Manila) or
 * later, and an edit can keep the date, move it forward or clear it, never move it back.
 */
class TaskDueDateRulesTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;
    private InternshipDeployment $dep;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->dep = InternshipDeployment::visibleToSupervisor($this->sup)->firstOrFail();
        Task::query()->delete();
        Sanctum::actingAs($this->sup);
    }

    private function payload(array $extra = []): array
    {
        return ['title' => 'Prepare report', 'priority' => 'medium', 'deployment_ids' => [$this->dep->id]] + $extra;
    }

    private function day(int $offset): string
    {
        return LocalTime::now()->addDays($offset)->toDateString();
    }

    private function taskDue(?string $date): Task
    {
        $id = $this->postJson('/api/supervisor/tasks', $this->payload(['due_date' => $date]))->assertOk()->json('id');

        return Task::findOrFail($id);
    }

    private function edit(Task $task, ?string $date)
    {
        return $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => $task->title, 'priority' => 'medium', 'due_date' => $date]);
    }

    public function test_create_with_a_past_date_is_refused(): void
    {
        $this->postJson('/api/supervisor/tasks', $this->payload(['due_date' => $this->day(-1)]))
            ->assertStatus(422)->assertJsonValidationErrors('due_date');
        $this->assertSame(0, Task::count());
    }

    public function test_create_for_today_in_manila_and_later_is_allowed(): void
    {
        $this->postJson('/api/supervisor/tasks', $this->payload(['due_date' => $this->day(0)]))->assertOk();
        $this->postJson('/api/supervisor/tasks', $this->payload(['due_date' => $this->day(5)]))->assertOk();
        $this->postJson('/api/supervisor/tasks', $this->payload())->assertOk(); // no due date is still fine
        $this->assertSame(3, Task::count());
    }

    public function test_edit_to_a_date_earlier_than_the_current_one_is_refused(): void
    {
        $task = $this->taskDue($this->day(10));

        $this->edit($task, $this->day(5))->assertStatus(422)->assertJsonValidationErrors('due_date');
        $this->assertSame($this->day(10), $task->fresh()->due_date->format('Y-m-d'));
    }

    public function test_edit_forward_or_to_the_same_day_is_allowed(): void
    {
        $task = $this->taskDue($this->day(3));

        $this->edit($task, $this->day(3))->assertOk();
        $this->edit($task, $this->day(9))->assertOk();
        $this->assertSame($this->day(9), $task->fresh()->due_date->format('Y-m-d'));
    }

    public function test_edit_can_clear_a_due_date_and_interns_are_told(): void
    {
        $dated = $this->taskDue($this->day(3));
        $internId = $dated->assignees()->value('user_id');

        $this->edit($dated, null)->assertOk()->assertJsonPath('changed', ['due_date']);
        $this->assertNull($dated->fresh()->due_date);

        $note = Notification::where('user_id', $internId)->where('type', 'task_updated')->latest('id')->first();
        $this->assertNotNull($note);
        $this->assertStringContainsString('removed the due date', $note->body);

        // An empty string clears too; a cleared task can get a new date, today or later only.
        $again = $this->taskDue($this->day(4));
        $this->patchJson("/api/supervisor/tasks/{$again->id}", ['title' => $again->title, 'priority' => 'medium', 'due_date' => ''])->assertOk();
        $this->assertNull($again->fresh()->due_date);
        $this->edit($dated, $this->day(-2))->assertStatus(422);
        $this->edit($dated, $this->day(2))->assertOk();
    }

    public function test_clearing_an_overdue_date_is_allowed(): void
    {
        $task = $this->taskDue($this->day(2));
        $task->update(['due_date' => $this->day(-4)]);

        $this->edit($task, null)->assertOk();
        $this->assertNull($task->fresh()->due_date);
    }

    public function test_omitting_due_date_keeps_the_old_date(): void
    {
        $task = $this->taskDue($this->day(6));

        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'Renamed', 'priority' => 'high'])->assertOk();
        $fresh = $task->fresh();
        $this->assertSame('Renamed', $fresh->title);
        $this->assertSame($this->day(6), $fresh->due_date->format('Y-m-d'));

        $overdue = $this->taskDue($this->day(1));
        $overdue->update(['due_date' => $this->day(-3)]);
        $this->patchJson("/api/supervisor/tasks/{$overdue->id}", ['title' => 'Renamed too', 'priority' => 'low'])->assertOk();
        $this->assertSame($this->day(-3), $overdue->fresh()->due_date->format('Y-m-d'));
    }

    public function test_overdue_task_keeps_its_date_when_other_fields_change(): void
    {
        $task = $this->taskDue($this->day(2));
        $task->update(['due_date' => $this->day(-4)]); // it went overdue

        $this->patchJson("/api/supervisor/tasks/{$task->id}", ['title' => 'New title', 'priority' => 'high', 'due_date' => $this->day(-4)])->assertOk();
        $fresh = $task->fresh();
        $this->assertSame('New title', $fresh->title);
        $this->assertSame($this->day(-4), $fresh->due_date->format('Y-m-d'));

        // A different past date, even one closer to today, cannot be re-picked; today or later can.
        $this->edit($task, $this->day(-2))->assertStatus(422);
        $this->edit($task, $this->day(-6))->assertStatus(422);
        $this->edit($task, $this->day(0))->assertOk();
    }

    public function test_subtask_due_date_cannot_be_in_the_past(): void
    {
        $task = $this->taskDue($this->day(7));

        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'Part 1', 'due_date' => $this->day(-1)])
            ->assertStatus(422)->assertJsonValidationErrors('due_date');
        $this->postJson("/api/supervisor/tasks/{$task->id}/subtasks", ['title' => 'Part 1', 'due_date' => $this->day(0)])->assertOk();
        $this->assertSame(1, $task->subtasks()->count());
    }
}
