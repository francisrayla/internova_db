<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent when a coordinator adds a supervisor or intern — unlike a coordinator
 * setting the recipient's password directly, this lets the actual account
 * owner set it themselves, which also proves they control the inbox (see
 * InvitationController::accept(), which marks email_verified_at at that
 * point).
 */
class AccountInvitation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $roleLabel,
        public readonly string $contextLabel,
        public readonly string $acceptUrl,
        public readonly string $expiresInDays,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "You're invited to join Internova as a {$this->roleLabel}");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.account-invitation');
    }
}
