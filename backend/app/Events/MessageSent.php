<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts immediately (no queue worker needed) on the recipient's own
 * public channel — same "public channel, name is the only access control"
 * posture as App\Events\NotificationCreated, since this app has no real
 * session/token auth to authorize a private channel with.
 */
class MessageSent implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message)
    {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel("user.{$this->message->receiver_id}.messages")];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }

    public function broadcastWith(): array
    {
        $replyTo = $this->message->replyTo;

        return [
            'id' => $this->message->id,
            'sender_id' => $this->message->sender_id,
            'receiver_id' => $this->message->receiver_id,
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
            'read_at' => null,
            'created_at' => $this->message->created_at->local()->format('g:i A'),
            'created_at_full' => $this->message->created_at->local()->format('F d, Y \a\t g:i A'),
        ];
    }
}
