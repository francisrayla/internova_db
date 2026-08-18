<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to Internova</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #059669, #047857); padding: 32px 36px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #a7f3d0; }
    .body { padding: 32px 36px; }
    .body p { margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #334155; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 100px; }
    .fallback { font-size: 12px; color: #94a3b8; word-break: break-all; margin-top: 8px; }
    .footer { background: #f1f5f9; padding: 20px 36px; }
    .footer p { margin: 0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6; }
    .badge { display: inline-block; background: #d1fae5; color: #065f46; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 100px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Internova AI</h1>
        <p>Internship Management Platform</p>
      </div>
      <div class="body">
        <span class="badge">School Account Invitation</span>
        <p>Dear <strong>{{ $coordinatorName }}</strong>,</p>
        <p>
          Great news — your school, <strong>{{ $schoolName }}</strong>, has been approved on Internova.
          To finish setting up your coordinator account, please set your password using the button below.
        </p>
        <div class="cta">
          <a href="{{ $acceptUrl }}">Set Up My Account</a>
        </div>
        <p class="fallback">Or copy this link into your browser: {{ $acceptUrl }}</p>
        <p>This invitation link expires in {{ $expiresInDays }} days. If you did not expect this email, you can safely ignore it.</p>
        <p style="margin-top: 24px;">Best regards,<br><strong>Internova AI Team</strong></p>
      </div>
      <div class="footer">
        <p>
          <a href="{{ url('/') }}">internova.ai</a> · hello@internova.ai · +63 917 123 4567
        </p>
      </div>
    </div>
  </div>
</body>
</html>
