<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/** Monday morning summary for the school's Dean (see DeanWeeklySummaryService). Queued. */
class DeanWeeklySummary extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public readonly array $summary) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Your weekly OJT summary for {$this->summary['school_name']}");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.dean-weekly-summary');
    }
}
