<?php

namespace App\Services;

use App\Events\NotificationCreated;
use App\Models\Notification;
use Illuminate\Support\Facades\Log;
use Throwable;

class NotificationService
{
    /**
     * Creates the notification record and broadcasts it in one step — every
     * trigger point in the app should go through here instead of creating
     * Notification rows directly, so nothing forgets to broadcast.
     *
     * $important controls whether it shows up in the bell dropdown and
     * notification history — pass false for rows created purely to wake up
     * live-refresh listeners on other open tabs (e.g. an admin's own action
     * echoed back to themselves), not to alert anyone of something new.
     */
    public static function send(
        string $audienceRole,
        string $type,
        string $title,
        ?string $body = null,
        ?int $schoolId = null,
        ?int $userId = null,
        ?string $link = null,
        bool $important = true
    ): Notification {
        $notification = Notification::create([
            'audience_role' => $audienceRole,
            'school_id'     => $schoolId,
            'user_id'       => $userId,
            'type'          => $type,
            'title'         => $title,
            'body'          => $body,
            'link'          => $link,
            'important'     => $important,
        ]);

        // The live-refresh broadcast is a convenience layer on top of the
        // notification row that just committed above — a downed/unstarted
        // Reverb server must never turn into a 500 for the real action that
        // triggered this (invite sent, plan change requested, etc.).
        try {
            broadcast(new NotificationCreated($notification));
        } catch (Throwable $e) {
            Log::warning('Notification broadcast failed, continuing without live push.', [
                'notification_id' => $notification->id,
                'error' => $e->getMessage(),
            ]);
        }

        return $notification;
    }

    public static function toSuperadmin(string $type, string $title, ?string $body = null, ?string $link = null, bool $important = true): Notification
    {
        return self::send('superadmin', $type, $title, $body, null, null, $link, $important);
    }

    public static function toSchoolCoordinators(int $schoolId, string $type, string $title, ?string $body = null, ?string $link = null, bool $important = true): Notification
    {
        return self::send('coordinator', $type, $title, $body, $schoolId, null, $link, $important);
    }

    /**
     * Targets one specific person rather than a whole role/school audience —
     * still broadcasts on that role's school-wide channel too (harmless, no
     * one has to be listening there), but critically also hits
     * user.{$userId}-notifications, which is the channel this person's own
     * bell (and any screen using useLiveRefresh) is actually subscribed to.
     */
    public static function toUser(string $audienceRole, int $userId, int $schoolId, string $type, string $title, ?string $body = null, ?string $link = null, bool $important = true): Notification
    {
        return self::send($audienceRole, $type, $title, $body, $schoolId, $userId, $link, $important);
    }
}
