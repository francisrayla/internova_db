<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Receipt for a subscription payment, sent once when PaymentActivation turns the subscription active
 * (PayMongo return, webhook, verified bank transfer or a manual confirmation by the Super Admin).
 */
class PaymentReceipt extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $schoolName,
        public readonly string $receiptNumber,
        public readonly string $planName,
        public readonly string $billingPeriod,
        public readonly string $amount,
        public readonly string $methodLabel,
        public readonly string $paidOn,
        public readonly ?string $validFrom,
        public readonly ?string $validUntil,
        public readonly string $billingUrl,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Payment received: Internova {$this->planName} plan");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.payment-receipt');
    }
}
