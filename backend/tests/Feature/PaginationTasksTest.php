<?php

namespace Tests\Feature;

use App\Models\InternshipDeployment;
use App\Models\Task;
use App\Models\TaskAssignee;
use App\Models\TaskEvaluation;
use App\Models\User;
use App\Services\PlanFeatures;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Task screens: the Active board comes back whole, History is paged and searched on the server. */
class PaginationTasksTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $supervisor;
    private User $intern;
    private User $coordinator;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Task::query()->delete();
        $this->dep = InternshipDeployment::firstOrFail();
        $this->supervisor = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
    }

    private function task(string $title, string $status, bool $rated = false): Task
    {
        $task = Task::create(['company_id' => $this->dep->company_id, 'assigned_by' => $this->supervisor->id, 'title' => $title, 'priority' => 'low', 'status' => $status]);
        TaskAssignee::create(['task_id' => $task->id, 'deployment_id' => $this->dep->id, 'user_id' => $this->dep->intern_id]);
        if ($rated) {
            TaskEvaluation::create(['task_id' => $task->id, 'evaluator_id' => $this->supervisor->id, 'rating' => 8, 'comments' => 'good', 'evaluated_at' => now()]);
        }

        return $task;
    }

    private function seedTasks(): void
    {
        foreach (range(1, 4) as $i) {
            $this->task("Open $i", $i % 2 ? 'pending' : 'in_progress');
        }
        foreach (range(1, 18) as $i) {
            $this->task("Rated $i", 'completed', true);
        }
    }

    public function test_supervisor_active_view_is_whole_and_history_is_paged_with_counts(): void
    {
        $this->seedTasks();
        Sanctum::actingAs($this->supervisor);

        $active = $this->getJson('/api/supervisor/tasks?view=active')->assertOk();
        $this->assertCount(4, $active->json('tasks'));
        $active->assertJsonPath('counts.active', 4)->assertJsonPath('counts.history', 18);
        $this->assertNotEmpty($active->json('interns')); // the assign dialog still gets its options

        $first = $this->getJson('/api/supervisor/tasks?view=history')->assertOk();
        $this->assertCount(15, $first->json('tasks'));
        $first->assertJsonPath('total', 18)->assertJsonPath('last_page', 2)->assertJsonPath('has_more', true);
        $second = $this->getJson('/api/supervisor/tasks?view=history&page=2')->assertOk();
        $this->assertCount(3, $second->json('tasks'));
        $this->assertEmpty(array_intersect(array_column($first->json('tasks'), 'id'), array_column($second->json('tasks'), 'id')));

        // search and the intern filter run over the whole history before paging
        $this->getJson('/api/supervisor/tasks?view=history&search=Rated 17')->assertJsonPath('total', 1);
        $this->getJson('/api/supervisor/tasks?view=history&deployment_id=' . $this->dep->id)->assertJsonPath('total', 18);
        $this->getJson('/api/supervisor/tasks?view=history&deployment_id=99999')->assertJsonPath('total', 0);
        $this->getJson('/api/supervisor/tasks?view=history&per_page=900')->assertJsonPath('per_page', 50);
    }

    public function test_a_finished_task_waiting_for_a_grade_stays_in_active(): void
    {
        $this->task('Done not graded', 'completed', false);
        $this->task('Done graded', 'completed', true);
        Sanctum::actingAs($this->supervisor);
        $ratings = PlanFeatures::has($this->supervisor->school, PlanFeatures::TASK_RATINGS);

        $active = $this->getJson('/api/supervisor/tasks?view=active')->assertOk();
        $history = $this->getJson('/api/supervisor/tasks?view=history')->assertOk();
        if ($ratings) {
            $this->assertSame(['Done not graded'], array_column($active->json('tasks'), 'title'));
            $active->assertJsonPath('counts.awaiting_rating', 1);
            $this->assertSame(['Done graded'], array_column($history->json('tasks'), 'title'));
        } else {
            $this->assertCount(0, $active->json('tasks'));
            $history->assertJsonPath('total', 2);
        }
    }

    public function test_no_view_keeps_returning_every_task(): void
    {
        $this->seedTasks();
        Sanctum::actingAs($this->supervisor);
        $this->assertCount(22, $this->getJson('/api/supervisor/tasks')->assertOk()->json('tasks'));
        Sanctum::actingAs($this->intern);
        $this->assertCount(22, $this->getJson('/api/intern/tasks')->assertOk()->json('tasks'));
        Sanctum::actingAs($this->coordinator);
        $this->assertCount(22, $this->getJson('/api/coordinator/tasks')->assertOk()->json('tasks'));
    }

    public function test_intern_history_is_paged_and_only_their_own(): void
    {
        $this->seedTasks();
        $other = Task::create(['company_id' => $this->dep->company_id, 'assigned_by' => $this->supervisor->id, 'title' => 'Not mine', 'priority' => 'low', 'status' => 'completed']);
        TaskEvaluation::create(['task_id' => $other->id, 'evaluator_id' => $this->supervisor->id, 'rating' => 5, 'comments' => 'x', 'evaluated_at' => now()]);
        Sanctum::actingAs($this->intern);

        $this->getJson('/api/intern/tasks?view=active')->assertOk()->assertJsonCount(4, 'tasks')->assertJsonPath('counts.history', 18);
        $h = $this->getJson('/api/intern/tasks?view=history')->assertOk();
        $this->assertCount(15, $h->json('tasks'));
        $h->assertJsonPath('total', 18);
        $this->assertCount(3, $this->getJson('/api/intern/tasks?view=history&page=2')->json('tasks'));
        $this->getJson('/api/intern/tasks?view=history&search=Not mine')->assertJsonPath('total', 0);
    }

    public function test_coordinator_company_history_summary_and_filters(): void
    {
        $this->seedTasks();
        Sanctum::actingAs($this->coordinator);
        $companyId = $this->dep->company_id;

        $this->getJson("/api/coordinator/tasks?view=active&company_id=$companyId")->assertOk()->assertJsonCount(4, 'tasks');
        $h = $this->getJson("/api/coordinator/tasks?view=history&company_id=$companyId")->assertOk();
        $this->assertCount(15, $h->json('tasks'));
        $h->assertJsonPath('total', 18);
        $this->getJson("/api/coordinator/tasks?view=history&company_id=$companyId&user_id={$this->dep->intern_id}")->assertJsonPath('total', 18);
        $this->getJson("/api/coordinator/tasks?view=history&company_id=$companyId&user_id=99999")->assertJsonPath('total', 0);
        $this->getJson('/api/coordinator/tasks?view=history&company_id=99999')->assertJsonPath('total', 0);

        $summary = $this->getJson('/api/coordinator/tasks?view=summary')->assertOk();
        $this->assertArrayNotHasKey('tasks', $summary->json());
        $row = collect($summary->json('companies'))->firstWhere('id', $companyId);
        $this->assertSame(22, $row['total']);
        $this->assertSame(18, $row['completed']);
        $this->assertSame(4, $row['active']);
    }

    public function test_other_roles_cannot_read_a_foreign_history(): void
    {
        $this->seedTasks();
        Sanctum::actingAs($this->intern);
        $this->getJson('/api/supervisor/tasks?view=history')->assertForbidden();
        $this->getJson('/api/coordinator/tasks?view=summary')->assertForbidden();
    }
}
