<?php

namespace Tests\Feature;

use App\Events\TaskChanged;
use App\Models\InternshipDeployment;
use App\Models\Subtask;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Open task screens update live: any change to a task (or a subtask, proof, comment, rating inside it)
 * pushes TaskChanged to the task's interns, the company's active supervisors and the school's
 * coordinator, on each one's own channel, and to nobody else.
 */
class TaskLiveUpdatesTest extends TestCase
{
    use RefreshDatabase;

    private User $sup;
    /** @var \Illuminate\Support\Collection<int, InternshipDeployment> */
    private $deps;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('public');
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

    /** Ana and Ben share a task (Ben leads) with one subtask for both; the first intern is not on it. */
    private function groupTaskWithSubtask(): array
    {
        [$outsider, $ana, $ben] = [$this->deps[0], $this->deps[1], $this->deps[2]];
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/supervisor/tasks', ['title' => 'Shared job', 'priority' => 'medium', 'deployment_ids' => [$ana->id, $ben->id], 'leader_id' => $ben->intern_id])->assertOk();
        $task = Task::firstOrFail();
        Sanctum::actingAs(User::findOrFail($ben->intern_id));
        $this->postJson("/api/intern/tasks/{$task->id}/subtasks", ['title' => 'Cable the 2nd floor', 'assignee_ids' => [$ana->intern_id, $ben->intern_id]])->assertOk();

        return [$task, Subtask::where('task_id', $task->id)->firstOrFail(), $outsider, $ana, $ben];
    }

    /** @return int[] user ids that got a TaskChanged for this task */
    private function pushedTo(int $taskId): array
    {
        return collect(Event::dispatched(TaskChanged::class))
            ->map(fn ($call) => $call[0])
            ->filter(fn (TaskChanged $e) => $e->taskId === $taskId)
            ->map(fn (TaskChanged $e) => $e->userId)
            ->unique()->sort()->values()->all();
    }

    private function expectedAudience(Task $task, array $interns): array
    {
        $company = $task->company_id;
        $school = DB::table('companies')->where('id', $company)->value('school_id');
        $supervisors = DB::table('supervisor_profiles')->join('users', 'users.id', '=', 'supervisor_profiles.user_id')
            ->where('company_id', $company)->where('users.status', 'active')->pluck('users.id')->all();
        $coordinators = DB::table('coordinator_profiles')->join('users', 'users.id', '=', 'coordinator_profiles.user_id')
            ->where('coordinator_profiles.school_id', $school)->where('users.status', 'active')->pluck('users.id')->all();

        return collect(array_merge($interns, $supervisors, $coordinators))->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
    }

    public function test_moving_a_subtask_reaches_every_member_the_supervisors_and_the_coordinator(): void
    {
        [$task, $subtask, $outsider, $ana, $ben] = $this->groupTaskWithSubtask();
        Event::fake([TaskChanged::class]);

        Sanctum::actingAs(User::findOrFail($ana->intern_id));
        $this->patchJson("/api/intern/subtasks/{$subtask->id}", ['status' => 'in_progress'])->assertOk();

        $to = $this->pushedTo($task->id);
        $this->assertSame($this->expectedAudience($task, [$ana->intern_id, $ben->intern_id]), $to);
        $this->assertContains($this->sup->id, $to);
        $this->assertContains((int) $ben->intern_id, $to, 'the other member sees the move');
        $this->assertNotContains((int) $outsider->intern_id, $to, 'an intern who is not on the task gets nothing');
        $dean = User::where('email', 'dean@internova.test')->value('id');
        $this->assertNotContains((int) $dean, $to);
    }

    public function test_each_push_goes_on_the_persons_own_channel_and_carries_only_the_task_id(): void
    {
        [$task, $subtask, , $ana] = $this->groupTaskWithSubtask();
        Event::fake([TaskChanged::class]);

        Sanctum::actingAs(User::findOrFail($ana->intern_id));
        $this->patchJson("/api/intern/subtasks/{$subtask->id}", ['status' => 'in_progress'])->assertOk();

        Event::assertDispatched(TaskChanged::class, function (TaskChanged $e) use ($task) {
            $this->assertSame(["private-user.{$e->userId}.tasks"], array_map(fn ($c) => $c->name, $e->broadcastOn()));
            $this->assertSame(['task_id' => $task->id], $e->broadcastWith());
            $this->assertSame('task.changed', $e->broadcastAs());

            return true;
        });
    }

    public function test_marking_a_subtask_done_with_proof_and_a_comment_are_pushed_too(): void
    {
        [$task, $subtask, , $ana, $ben] = $this->groupTaskWithSubtask();

        Event::fake([TaskChanged::class]);
        Sanctum::actingAs(User::findOrFail($ana->intern_id));
        $this->post("/api/intern/subtasks/{$subtask->id}/complete", ['proofs' => [UploadedFile::fake()->create('proof.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        $this->assertContains((int) $ben->intern_id, $this->pushedTo($task->id), 'Done reaches the other member');
        $this->assertContains($this->sup->id, $this->pushedTo($task->id), 'and the supervisor');

        Event::fake([TaskChanged::class]);
        Sanctum::actingAs($this->sup);
        $this->postJson("/api/supervisor/tasks/{$task->id}/comments", ['comment' => 'Nice work'])->assertOk();
        $this->assertContains((int) $ana->intern_id, $this->pushedTo($task->id), "the supervisor's comment reaches the interns");
    }

    public function test_in_a_web_request_each_person_gets_one_push_after_the_response(): void
    {
        [$task, $subtask, , $ana, $ben] = $this->groupTaskWithSubtask();
        // the live server is not a console process: pushes wait for the end of the request
        (new \ReflectionProperty($this->app, 'isRunningInConsole'))->setValue($this->app, false);
        Event::fake([TaskChanged::class]);

        Sanctum::actingAs(User::findOrFail($ana->intern_id));
        // saves the subtask AND recalculates the task: still one push per person
        $this->patchJson("/api/intern/subtasks/{$subtask->id}", ['status' => 'in_progress'])->assertOk();

        $calls = collect(Event::dispatched(TaskChanged::class))->map(fn ($c) => $c[0])->filter(fn ($e) => $e->taskId === $task->id);
        $this->assertSame($this->expectedAudience($task, [$ana->intern_id, $ben->intern_id]), $calls->pluck('userId')->unique()->sort()->values()->all());
        $this->assertSame($calls->count(), $calls->pluck('userId')->unique()->count(), 'no one gets the same task twice for one request');
    }

    public function test_a_user_may_only_listen_to_their_own_task_channel(): void
    {
        $intern = User::findOrFail($this->deps[1]->intern_id);
        $channels = app(\Illuminate\Broadcasting\BroadcastManager::class)->connection();
        // routes/channels.php: the callback is the authorisation rule
        $rule = (new \ReflectionProperty($channels, 'channels'))->getValue($channels)['user.{id}.tasks'];
        $this->assertTrue($rule($intern, $intern->id));
        $this->assertFalse($rule($intern, $intern->id + 1));
    }
}
