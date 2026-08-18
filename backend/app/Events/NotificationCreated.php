<?php

namespace App\Events;

use App\Models\Notification;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts immediately (no queue worker needed) on a PUBLIC channel scoped
 * by audience role (+ school, for school-scoped roles). This app has no real
 * session/token auth yet (see AuthController) so private/presence channels
 * aren't viable here — the channel name itself is the only "access control",
 * matching the same demo-grade security posture as the rest of the API.
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
            return [new Channel('superadmin-notifications')];
        }

        $channels = [new Channel("school.{$this->notification->school_id}.{$role}-notifications")];

        if ($this->notification->user_id) {
            $channels[] = new Channel("user.{$this->notification->user_id}-notifications");
        }

        return $channels;
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
            'created_at' => $this->notification->created_at->format('F d, Y \a\t g:i A'),
        ];
    }
}
