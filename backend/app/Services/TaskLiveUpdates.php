<?php

namespace App\Services;

use App\Events\TaskChanged;
use App\Models\Subtask;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskEvaluation;
use App\Models\TaskProof;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Live task screens. Whenever a task or anything inside it changes (status, a subtask moved, proof,
 * comment, rating, edit), everyone who can see that task gets a TaskChanged push on their own
 * channel (user.{id}.tasks) and their open task screens reload quietly — so a member moving a
 * subtask to Ongoing shows up on the other members' and the supervisors' screens without a refresh.
 *
 * Who gets it: the task's interns, every active supervisor of its company, and the school's
 * coordinator. The pushes go out once per task per request, after the response (one request can
 * touch a subtask AND recalculate its task), and a broadcast that fails is only logged.
 */
class TaskLiveUpdates
{
    /** @var array<int, int[]> task id => recipients known when it was first touched */
    private static array $pending = [];

    private static bool $flushScheduled = false;

    public static function register(): void
    {
        $task = fn (Task $t) => self::touch($t->id);
        Task::saved($task);
        Task::deleting($task);
        foreach ([Subtask::class, TaskComment::class, TaskEvaluation::class] as $model) {
            $model::saved(fn ($m) => self::touch($m->task_id));
            $model::deleted(fn ($m) => self::touch($m->task_id));
        }
        // A subtask's proof carries only the subtask id.
        $proof = fn (TaskProof $p) => self::touch($p->task_id ?: Subtask::whereKey($p->subtask_id)->value('task_id'));
        TaskProof::saved($proof);
        TaskProof::deleted($proof);
    }

    public static function touch(?int $taskId): void
    {
        if (!$taskId) {
            return;
        }
        // Queue workers, artisan commands and tests never reach the end of an HTTP request, so there the
        // push goes out at once instead of waiting for it.
        if (app()->runningInConsole()) {
            self::send($taskId, self::recipients($taskId));
            return;
        }
        if (isset(self::$pending[$taskId])) {
            return;
        }
        // Recipients now, in case the task is gone by the time the pushes go out (a deleted task).
        self::$pending[$taskId] = self::recipients($taskId);

        if (!self::$flushScheduled) {
            self::$flushScheduled = true;
            app()->terminating(fn () => self::flush());
        }
    }

    public static function flush(): void
    {
        $pending = self::$pending;
        self::$pending = [];
        self::$flushScheduled = false;

        foreach ($pending as $taskId => $known) {
            // Read again at the end: interns assigned in this same request count too.
            if (!self::send($taskId, array_merge($known, self::recipients($taskId)))) {
                return; // the socket server is down: the rest would fail the same way
            }
        }
    }

    /** @param int[] $users */
    private static function send(int $taskId, array $users): bool
    {
        foreach (array_unique($users) as $userId) {
            try {
                broadcast(new TaskChanged($userId, $taskId));
            } catch (Throwable $e) {
                Log::warning('Task live update failed, continuing without the push.', [
                    'task_id' => $taskId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
                return false;
            }
        }
        return true;
    }

    /** @return int[] */
    public static function recipients(int $taskId): array
    {
        $task = DB::table('tasks')->where('id', $taskId)->first(['id', 'company_id']);
        if (!$task) {
            return [];
        }

        $interns = DB::table('task_assignees')->where('task_id', $taskId)->whereNotNull('user_id')->pluck('user_id');

        $schoolId = $task->company_id ? DB::table('companies')->where('id', $task->company_id)->value('school_id') : null;

        $supervisors = $task->company_id
            ? DB::table('supervisor_profiles')
                ->join('users', 'users.id', '=', 'supervisor_profiles.user_id')
                ->where('supervisor_profiles.company_id', $task->company_id)
                ->where('users.status', 'active')
                ->pluck('users.id')
            : collect();

        $coordinators = $schoolId
            ? DB::table('coordinator_profiles')
                ->join('users', 'users.id', '=', 'coordinator_profiles.user_id')
                ->where('coordinator_profiles.school_id', $schoolId)
                ->where('users.status', 'active')
                ->pluck('users.id')
            : collect();

        return $interns->merge($supervisors)->merge($coordinators)->map(fn ($id) => (int) $id)->unique()->values()->all();
    }
}
