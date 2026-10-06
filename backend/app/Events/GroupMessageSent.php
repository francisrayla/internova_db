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
        $replyTo = $this->message->replyTo;

        return [
            'id' => $this->message->id,
            'group_id' => $this->message->group_conversation_id,
            'sender_id' => $this->message->sender_id,
            'sender_name' => trim("{$this->message->sender?->first_name} {$this->message->sender?->last_name}") ?: $this->message->sender?->name,
            'message' => $this->message->message,
            'attachment_url' => $this->message->attachment_url,
            'attachment_name' => $this->message->attachment_name,
            'attachment_type' => $this->message->attachment_type,
            'attachment_size' => $this->message->attachment_size,
            'reply_to' => $replyTo ? [
                'id' => $replyTo->id,
                'sender_name' => trim("{$replyTo->sender?->first_name} {$replyTo->sender?->last_name}") ?: $replyTo->sender?->name,
                'preview' => $replyTo->message !== '' ? $replyTo->message : ($replyTo->attachment_path ? (str_starts_with((string) $replyTo->attachment_type, 'image/') ? '📷 Photo' : '📎 ' . ($replyTo->attachment_name ?? 'File')) : null),
            ] : null,
            'created_at' => $this->message->created_at->local()->format('g:i A'),
        ];
    }
}
