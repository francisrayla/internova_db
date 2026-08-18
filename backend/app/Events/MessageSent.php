<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\Channel;
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
        return [new Channel("user.{$this->message->receiver_id}-messages")];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'sender_id' => $this->message->sender_id,
            'receiver_id' => $this->message->receiver_id,
            'sender_name' => trim("{$this->message->sender?->first_name} {$this->message->sender?->last_name}") ?: $this->message->sender?->name,
            'message' => $this->message->message,
            'created_at' => $this->message->created_at->format('g:i A'),
            'created_at_full' => $this->message->created_at->format('F d, Y \a\t g:i A'),
        ];
    }
}
