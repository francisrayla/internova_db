<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

// Queued (see AccountInvitation for why) — sendReply() responds instantly
// instead of blocking on a live SMTP handshake.
class InquiryReply extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $schoolName,
        public readonly string $replySubject,
        public readonly string $replyBody,
        public readonly ?string $replyToEmail = null,
        public readonly ?string $replyToName = null,
    ) {}

    public function envelope(): Envelope
    {
        // Sent from the platform's noreply address, which has no inbox — so a
        // school answering this would otherwise be talking to no one. Point
        // their reply at the Super Admin who actually wrote it.
        // isset(), not a plain read: a reply queued before these two fields
        // existed unserializes with them uninitialized, and reading an
        // uninitialized typed property throws instead of returning null.
        $replyTo = isset($this->replyToEmail) && $this->replyToEmail
            ? [new Address($this->replyToEmail, $this->replyToName ?? null)]
            : [];

        return new Envelope(subject: $this->replySubject, replyTo: $replyTo);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.inquiry-reply');
    }
}
