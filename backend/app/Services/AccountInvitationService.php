<?php

namespace App\Services;

use App\Mail\AccountInvitation;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Issues a "set your own password" invitation (7-day token, queued email).
 * Shared by the coordinator (interns), the Dean (coordinator) and the Super
 * Admin (dean). The recipient proves control of the inbox by clicking the
 * link — see InvitationController::accept().
 */
class AccountInvitationService
{
    public const EXPIRES_IN_DAYS = 7;

    /**
     * The mail is relayed through the system's SMTP account but shows the
     * inviter's name as the sender and their address as Reply-To, so replies
     * reach the person who actually invited them.
     */
    public static function send(User $user, string $roleLabel, string $contextLabel, string $inviterName, string $inviterEmail, ?int $delaySeconds = null): void
    {
        $plainToken = Str::random(64);

        $user->update([
            'invitation_token' => hash('sha256', $plainToken),
            'invitation_expires_at' => now()->addDays(self::EXPIRES_IN_DAYS),
        ]);

        $mail = new AccountInvitation(
            recipientName: trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            roleLabel: $roleLabel,
            contextLabel: $contextLabel,
            acceptUrl: config('app.frontend_url') . '/accept-invite/' . $plainToken,
            expiresInDays: (string) self::EXPIRES_IN_DAYS,
            coordinatorName: $inviterName,
            coordinatorEmail: $inviterEmail,
        );

        // A bulk import staggers its invitations so a batch doesn't hit the
        // mail provider all in the same second.
        $pending = Mail::to($user->email, $user->name);
        $delaySeconds ? $pending->later(now()->addSeconds($delaySeconds), $mail) : $pending->queue($mail);
    }
}
