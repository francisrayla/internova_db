<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Tells the other person's open chat that a message was unsent, on the same
 * private channel MessageSent uses. Carries only ids — the old text and
 * attachment are already gone from the row and never travel with this event.
 */
class MessageUnsent implements ShouldBroadcastNow
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
        return 'message.unsent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'sender_id' => $this->message->sender_id,
            'receiver_id' => $this->message->receiver_id,
        ];
    }
}
