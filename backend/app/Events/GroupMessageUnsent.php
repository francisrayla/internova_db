<?php

namespace App\Events;

use App\Models\GroupMessage;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Group counterpart of MessageUnsent: fans out to every other member's own
 * private channel, with the group id so the widget updates the right thread.
 */
class GroupMessageUnsent implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public GroupMessage $message, public array $recipientUserIds)
    {
    }

    public function broadcastOn(): array
    {
        return array_map(fn (int $userId) => new PrivateChannel("user.{$userId}.messages"), $this->recipientUserIds);
    }

    public function broadcastAs(): string
    {
        return 'group.message.unsent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'group_id' => $this->message->group_conversation_id,
            'sender_id' => $this->message->sender_id,
        ];
    }
}
