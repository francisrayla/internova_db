<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Group version of UserTyping — same unpersisted, expires-on-its-own pulse,
 * just fanned out to every other member of the group instead of one
 * recipient.
 */
class GroupUserTyping implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public int $groupId, public array $recipientUserIds, public int $senderId, public string $senderName)
    {
    }

    public function broadcastOn(): array
    {
        return array_map(fn (int $userId) => new Channel("user.{$userId}-messages"), $this->recipientUserIds);
    }

    public function broadcastAs(): string
    {
        return 'group.user.typing';
    }

    public function broadcastWith(): array
    {
        return [
            'group_id' => $this->groupId,
            'sender_id' => $this->senderId,
            'sender_name' => $this->senderName,
        ];
    }
}
