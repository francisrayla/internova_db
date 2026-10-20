<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/**
 * "This task just changed — reload it" for one person (App\Services\TaskLiveUpdates decides who).
 * Carries only the task id: every screen refetches through the normal API, so nothing it should not
 * see ever travels over the socket. Broadcasts at once (no queue worker), like NotificationCreated.
 */
class TaskChanged implements ShouldBroadcastNow
{
    public function __construct(public int $userId, public int $taskId)
    {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel("user.{$this->userId}.tasks")];
    }

    public function broadcastAs(): string
    {
        return 'task.changed';
    }

    public function broadcastWith(): array
    {
        return ['task_id' => $this->taskId];
    }
}
