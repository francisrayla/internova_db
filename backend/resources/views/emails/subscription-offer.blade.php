<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Internova offer is ready</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 36px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #bfdbfe; }
    .body { padding: 32px 36px; }
    .body p { margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #334155; }
    .summary { width: 100%; border-collapse: collapse; margin: 8px 0 24px; font-size: 15px; }
    .summary td { padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .summary td.value { text-align: right; font-weight: 600; color: #0f172a; }
    .summary tr.total td { border-bottom: 0; font-size: 17px; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 100px; }
    .fallback { font-size: 12px; color: #94a3b8; word-break: break-all; margin-top: 8px; }
    .footer { background: #f1f5f9; padding: 20px 36px; }
    .footer p { margin: 0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6; }
    .footer a { color: #2563eb; text-decoration: none; }
    .badge { display: inline-block; background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 100px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Internova</h1>
        <p>Internship Management Platform</p>
      </div>
      <div class="body">
        <span class="badge">{{ $resent ? 'New subscription offer' : 'Registration approved' }}</span>
        <p>Dear <strong>{{ $recipientName }}</strong>,</p>
        @if ($resent)
        <p>A new subscription offer is ready for <strong>{{ $schoolName }}</strong>. The earlier offer is no longer valid, so please review this one.</p>
        @else
        <p>Good news: <strong>{{ $schoolName }}</strong> has been approved on Internova. Your subscription offer is ready for you to review and accept as the school's {{ $headTitle }}.</p>
        @endif
        <table class="summary" role="presentation">
          <tr><td>Plan</td><td class="value">{{ $planName }} ({{ $billingPeriod }})</td></tr>
          @if ($listPrice && $discount)
          <tr><td>List price</td><td class="value">&#8369;{{ $listPrice }}</td></tr>
          <tr><td>Discount</td><td class="value">&minus;&#8369;{{ $discount }}</td></tr>
          @endif
          <tr class="total"><td>Amount due</td><td class="value">&#8369;{{ $amount }}</td></tr>
        </table>
        @if ($expiresOn)
        <p>This offer is valid until <strong>{{ $expiresOn }}</strong>.</p>
        @endif
        <p>Sign in with the email and password you used when you registered, review the offer, then choose how to pay (GCash, Maya, card or bank transfer). Your school's workspace opens as soon as the payment is confirmed.</p>
        <div class="cta">
          <a href="{{ $billingUrl }}">Review My Offer</a>
        </div>
        <p class="fallback">Or copy this link into your browser: {{ $billingUrl }}</p>
        <p style="margin-top: 24px;">Best regards,<br><strong>Internova Team</strong></p>
      </div>
      <div class="footer">
        <p>
          You are receiving this because your school registered on Internova.<br>
          @include('emails.partials.footer-links')
        </p>
      </div>
    </div>
  </div>
</body>
</html>
