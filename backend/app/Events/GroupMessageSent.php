<?php

namespace App\Events;

use App\Models\GroupMessage;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Fans out to every other member's own personal channel — the same
 * "user.{id}-messages" channel 1:1 MessageSent already uses, just with more
 * recipients and a group_id on the payload so the frontend can tell the two
 * apart and route the update to the right conversation. The sender isn't
 * included; their own client already appends the message optimistically.
 */
class GroupMessageSent implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public GroupMessage $message, public array $recipientUserIds)
    {
    }

    public function broadcastOn(): array
    {
        return array_map(fn (int $userId) => new Channel("user.{$userId}-messages"), $this->recipientUserIds);
    }

    public function broadcastAs(): string
    {
        return 'group.message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'group_id' => $this->message->group_conversation_id,
            'sender_id' => $this->message->sender_id,
            'sender_name' => trim("{$this->message->sender?->first_name} {$this->message->sender?->last_name}") ?: $this->message->sender?->name,
            'message' => $this->message->message,
            'created_at' => $this->message->created_at->format('g:i A'),
        ];
    }
}
