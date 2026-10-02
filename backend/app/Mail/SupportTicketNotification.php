<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

// Queued (see AccountInvitation for why) — firing this inline on every
// ticket reply would make the reply endpoint wait on a live SMTP handshake.
// Reused for both directions of the support-ticket conversation (a
// coordinator's message notifying Super Admin, or Super Admin's reply
// notifying the coordinator) since the email only needs to show who sent
// what and where to go read the rest.
class SupportTicketNotification extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $senderLabel,
        public readonly string $ticketSubject,
        public readonly string $messageBody,
        public readonly bool $hasAttachment,
        public readonly string $ticketUrl,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "New reply: {$this->ticketSubject}");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.support-ticket-notification');
    }
}
