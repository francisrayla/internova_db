<?php

namespace App\Events;

use App\Models\Notification;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts immediately (no queue worker needed) on PRIVATE channels (authorized in
 * routes/channels.php): the whole audience (role + school; platform admins for superadmin), or,
 * for a personal notification, only that one person's own channel so colleagues with the same role
 * never receive it.
 */
class NotificationCreated implements ShouldBroadcastNow
{
    use InteractsWithSockets, SerializesModels;

    public function __construct(public Notification $notification)
    {
    }

    public function broadcastOn(): array
    {
        $role = $this->notification->audience_role;

        if ($role === 'superadmin') {
            return [new PrivateChannel('superadmin.notifications')];
        }

        if ($this->notification->user_id) {
            return [new PrivateChannel("user.{$this->notification->user_id}.notifications")];
        }

        return [new PrivateChannel("school.{$this->notification->school_id}.{$role}.notifications")];
    }

    public function broadcastAs(): string
    {
        return 'notification.created';
    }

    public function broadcastWith(): array
    {
        return [
            'id'         => $this->notification->id,
            'type'       => $this->notification->type,
            'title'      => $this->notification->title,
            'body'       => $this->notification->body,
            'link'       => $this->notification->link,
            'important'  => $this->notification->important,
            'created_at' => $this->notification->created_at->local()->format('F d, Y \a\t g:i A'),
        ];
    }
}
