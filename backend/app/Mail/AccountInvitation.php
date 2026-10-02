<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent when a coordinator adds a supervisor or intern — unlike a coordinator
 * setting the recipient's password directly, this lets the actual account
 * owner set it themselves, which also proves they control the inbox (see
 * InvitationController::accept(), which marks email_verified_at at that
 * point).
 *
 * ShouldQueue: a live SMTP handshake to Gmail takes several seconds — with
 * this queued (dispatched via ->queue(), not ->send()), "Add intern"/"Add
 * supervisor" responds as soon as the account is created, and the actual
 * send happens in the background via `php artisan queue:work`.
 */
class AccountInvitation extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $roleLabel,
        public readonly string $contextLabel,
        public readonly string $acceptUrl,
        public readonly string $expiresInDays,
        public readonly string $coordinatorName,
        public readonly string $coordinatorEmail,
    ) {}

    /**
     * The message still goes out through the system's own SMTP account (an
     * arbitrary From address a mail server doesn't control gets rejected by
     * SPF/DKIM checks) — but the coordinator's name in the display name and
     * their real address as Reply-To makes it read as coming from them, and
     * sends any reply straight to their inbox instead of ours.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            from: new Address(config('mail.from.address'), "{$this->coordinatorName} via Internova"),
            replyTo: [new Address($this->coordinatorEmail, $this->coordinatorName)],
            subject: "You're invited to join Internova as a {$this->roleLabel}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.account-invitation');
    }
}
