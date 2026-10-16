<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment received</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #059669, #047857); padding: 32px 36px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #a7f3d0; }
    .body { padding: 32px 36px; }
    .body p { margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #334155; }
    .summary { width: 100%; border-collapse: collapse; margin: 8px 0 24px; font-size: 15px; }
    .summary td { padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .summary td.value { text-align: right; font-weight: 600; color: #0f172a; }
    .summary tr.total td { border-bottom: 0; font-size: 17px; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 100px; }
    .footer { background: #f1f5f9; padding: 20px 36px; }
    .footer p { margin: 0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6; }
    .footer a { color: #059669; text-decoration: none; }
    .badge { display: inline-block; background: #d1fae5; color: #065f46; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 100px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Internova</h1>
        <p>Payment receipt</p>
      </div>
      <div class="body">
        <span class="badge">Payment received</span>
        <p>Dear <strong>{{ $recipientName }}</strong>,</p>
        <p>Thank you. We received the payment for <strong>{{ $schoolName }}</strong>, and your Internova subscription is now active.</p>
        <table class="summary" role="presentation">
          <tr><td>Receipt number</td><td class="value">{{ $receiptNumber }}</td></tr>
          <tr><td>Plan</td><td class="value">{{ $planName }} ({{ $billingPeriod }})</td></tr>
          <tr><td>Paid with</td><td class="value">{{ $methodLabel }}</td></tr>
          <tr><td>Paid on</td><td class="value">{{ $paidOn }}</td></tr>
          @if ($validFrom && $validUntil)
          <tr><td>Covers</td><td class="value">{{ $validFrom }} to {{ $validUntil }}</td></tr>
          @endif
          <tr class="total"><td>Amount paid</td><td class="value">&#8369;{{ $amount }}</td></tr>
        </table>
        <p>Keep this email for your records. You can also see your billing details in Internova at any time.</p>
        <div class="cta">
          <a href="{{ $billingUrl }}">Open Billing</a>
        </div>
        <p style="margin-top: 24px;">Best regards,<br><strong>Internova Team</strong></p>
      </div>
      <div class="footer">
        <p>
          Questions about this payment? Write to us at the address below.<br>
          @include('emails.partials.footer-links')
        </p>
      </div>
    </div>
  </div>
</body>
</html>
