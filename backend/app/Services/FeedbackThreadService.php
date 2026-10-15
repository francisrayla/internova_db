<?php

namespace App\Services;

use App\Models\DeanFeedback;
use App\Models\DeanFeedbackReply;
use App\Models\User;
use App\Support\HeadTitle;
use Illuminate\Support\Str;

/**
 * Dean <-> coordinator feedback threads. A thread is one dean_feedback row
 * (the Dean's first message) plus dean_feedback_replies.
 *
 * Status: open -> acknowledged (coordinator taps Acknowledge, or replies) -> resolved
 * (Dean). The Dean can reopen a resolved thread (back to acknowledged if it had
 * been acknowledged, otherwise open). The coordinator cannot reply to a resolved
 * thread; the Dean can always reply.
 * Unread: the coordinator has unread = root message not read yet, or any unread Dean reply.
 * The Dean has unread = any coordinator reply not read yet.
 */
class FeedbackThreadService
{
    private static function name(?User $u, string $fallback): string
    {
        return $u ? (trim("{$u->first_name} {$u->last_name}") ?: $u->name) : $fallback;
    }

    public static function payload(DeanFeedback $f, string $viewer): array
    {
        $f->loadMissing(['dean', 'coordinator', 'replies.user']);
        $replies = $f->replies->map(fn (DeanFeedbackReply $r) => [
            'id' => $r->id,
            'sender_role' => $r->sender_role,
            'sender_name' => self::name($r->user, $r->sender_role === 'dean' ? 'Your ' . HeadTitle::forSchool($f->school_id) : 'Coordinator'),
            'message' => $r->message,
            'created_at' => $r->created_at->toIso8601String(),
            'mine' => $r->sender_role === $viewer,
            'unread' => $r->sender_role !== $viewer && $r->read_at === null,
        ])->values();

        $unread = $viewer === 'coordinator'
            ? ($f->read_at === null ? 1 : 0) + $replies->where('sender_role', 'dean')->where('unread', true)->count()
            : $replies->where('sender_role', 'coordinator')->where('unread', true)->count();

        return [
            'id' => $f->id,
            'message' => $f->message,
            'created_at' => $f->created_at->toIso8601String(),
            'status' => $f->status ?? DeanFeedback::OPEN,
            'acknowledged_at' => $f->acknowledged_at?->toIso8601String(),
            'resolved_at' => $f->resolved_at?->toIso8601String(),
            'read_at' => $f->read_at?->toIso8601String(),
            'seen' => $f->read_at !== null,
            'read' => $f->read_at !== null,
            'dean_name' => self::name($f->dean, 'Your ' . HeadTitle::forSchool($f->school_id)),
            'coordinator_name' => self::name($f->coordinator, 'Coordinator'),
            'replies' => $replies,
            'unread' => $unread,
            'can_reply' => $viewer === 'dean' || ($f->status ?? DeanFeedback::OPEN) !== DeanFeedback::RESOLVED,
        ];
    }

    public static function deanUnread(int $schoolId): int
    {
        return DeanFeedbackReply::where('sender_role', 'coordinator')->whereNull('read_at')
            ->whereHas('feedback', fn ($q) => $q->where('school_id', $schoolId))->count();
    }

    public static function coordinatorUnread(User $coordinator): int
    {
        return DeanFeedback::where('coordinator_id', $coordinator->id)->where('school_id', $coordinator->school_id)
            ->where(function ($q) {
                $q->whereNull('read_at')->orWhereHas('replies', fn ($r) => $r->where('sender_role', 'dean')->whereNull('read_at'));
            })->count();
    }

    public static function markReadFor(string $viewer, DeanFeedback $f): void
    {
        if ($viewer === 'coordinator') {
            $f->update(['read_at' => $f->read_at ?? now()]);
            $f->replies()->where('sender_role', 'dean')->whereNull('read_at')->update(['read_at' => now()]);
        } else {
            $f->replies()->where('sender_role', 'coordinator')->whereNull('read_at')->update(['read_at' => now()]);
        }
    }

    public static function reply(DeanFeedback $f, User $user, string $role, string $message): DeanFeedbackReply
    {
        $reply = $f->replies()->create(['user_id' => $user->id, 'sender_role' => $role, 'message' => trim($message)]);

        if ($role === 'coordinator') {
            // Replying implies "I've seen this".
            $updates = ['read_at' => $f->read_at ?? now()];
            if ($f->status === DeanFeedback::OPEN) {
                $updates += ['status' => DeanFeedback::ACKNOWLEDGED, 'acknowledged_at' => now()];
            }
            $f->update($updates);
            $f->replies()->where('sender_role', 'dean')->whereNull('read_at')->update(['read_at' => now()]);
            NotificationService::toUser('dean', $f->dean_id, $f->school_id, 'dean_feedback_reply',
                'Your coordinator replied', Str::limit($reply->message, 120), '/dean/coordinator?tab=feedback');
        } else {
            NotificationService::toUser('coordinator', $f->coordinator_id, $f->school_id, 'dean_feedback',
                'Your ' . HeadTitle::forSchool($f->school_id) . ' replied', Str::limit($reply->message, 120), '/coordinator/feedback');
        }

        return $reply;
    }

    public static function acknowledge(DeanFeedback $f): void
    {
        $f->update(['read_at' => $f->read_at ?? now()]);
        if ($f->status !== DeanFeedback::OPEN) {
            return;
        }
        $f->update(['status' => DeanFeedback::ACKNOWLEDGED, 'acknowledged_at' => now()]);
        NotificationService::toUser('dean', $f->dean_id, $f->school_id, 'dean_feedback_ack',
            'Your coordinator acknowledged your feedback', Str::limit($f->message, 120), '/dean/coordinator?tab=feedback');
    }

    public static function resolve(DeanFeedback $f): void
    {
        if ($f->status === DeanFeedback::RESOLVED) {
            return;
        }
        $f->update(['status' => DeanFeedback::RESOLVED, 'resolved_at' => now()]);
        NotificationService::toUser('coordinator', $f->coordinator_id, $f->school_id, 'dean_feedback',
            'Your ' . HeadTitle::forSchool($f->school_id) . ' marked feedback as resolved', Str::limit($f->message, 120), '/coordinator/feedback');
    }

    public static function reopen(DeanFeedback $f): void
    {
        if ($f->status !== DeanFeedback::RESOLVED) {
            return;
        }
        $f->update(['status' => $f->acknowledged_at ? DeanFeedback::ACKNOWLEDGED : DeanFeedback::OPEN, 'resolved_at' => null]);
        NotificationService::toUser('coordinator', $f->coordinator_id, $f->school_id, 'dean_feedback',
            'Your ' . HeadTitle::forSchool($f->school_id) . ' reopened a feedback thread', Str::limit($f->message, 120), '/coordinator/feedback');
    }
}
