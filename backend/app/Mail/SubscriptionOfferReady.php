<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to the school head when the Super Admin approves the registration (or resends an expired offer), so a
 * new school learns its offer is waiting without having to log in first. Plain values only, so the queued job
 * does not depend on models that may change before it runs.
 */
class SubscriptionOfferReady extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $headTitle,
        public readonly string $schoolName,
        public readonly string $planName,
        public readonly string $billingPeriod,
        public readonly string $amount,
        public readonly ?string $listPrice,
        public readonly ?string $discount,
        public readonly ?string $expiresOn,
        public readonly string $billingUrl,
        public readonly bool $resent = false,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->resent ? 'Your new Internova offer is ready' : 'Your Internova offer is ready');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.subscription-offer');
    }
}
