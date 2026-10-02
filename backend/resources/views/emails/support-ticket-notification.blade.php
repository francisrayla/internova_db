<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ $ticketSubject }}</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 36px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #bfdbfe; }
    .body { padding: 32px 36px; }
    .body p { margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #334155; }
    .body .message-block { white-space: pre-wrap; background: #f1f5f9; border-left: 4px solid #2563eb; padding: 16px 20px; border-radius: 8px; font-size: 15px; line-height: 1.7; color: #334155; margin: 20px 0; }
    .attachment-note { font-size: 13px; color: #64748b; margin: -8px 0 16px; }
    .button { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 10px; }
    .footer { background: #f1f5f9; padding: 20px 36px; }
    .footer p { margin: 0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6; }
    .badge { display: inline-block; background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 100px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Internova</h1>
        <p>Support ticket update</p>
      </div>
      <div class="body">
        <span class="badge">{{ $ticketSubject }}</span>
        <p>Hi <strong>{{ $recipientName }}</strong>,</p>
        <p><strong>{{ $senderLabel }}</strong> sent a new message on this support ticket:</p>
        <div class="message-block">{{ $messageBody }}</div>
        @if($hasAttachment)
          <p class="attachment-note">📎 This message includes an attachment — view it on the ticket page.</p>
        @endif
        <p style="text-align: center; margin: 28px 0 8px;">
          <a href="{{ $ticketUrl }}" class="button">View ticket</a>
        </p>
      </div>
      <div class="footer">
        <p>
          You're receiving this because you're part of this support ticket's conversation on Internova.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
