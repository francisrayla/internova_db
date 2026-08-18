<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SchoolInvitation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $coordinatorName,
        public readonly string $schoolName,
        public readonly string $acceptUrl,
        public readonly string $expiresInDays,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "You're invited to set up {$this->schoolName} on Internova");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.school-invitation');
    }
}
