<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * A pure, unpersisted signal — nothing is written to the database for this,
 * it just tells the recipient's open chat window "this person is typing
 * right now" so the UI can show it and let it expire on its own a few
 * seconds later. Same public-channel convention as MessageSent/
 * NotificationCreated (see those classes for why).
 */
class UserTyping implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public int $receiverId, public int $senderId, public string $senderName)
    {
    }

    public function broadcastOn(): array
    {
        return [new Channel("user.{$this->receiverId}-messages")];
    }

    public function broadcastAs(): string
    {
        return 'user.typing';
    }

    public function broadcastWith(): array
    {
        return [
            'sender_id' => $this->senderId,
            'sender_name' => $this->senderName,
        ];
    }
}
