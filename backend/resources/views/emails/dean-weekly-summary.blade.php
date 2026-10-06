<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly OJT summary</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #bfdbfe; }
    .body { padding: 28px 32px; }
    .body p { margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #334155; }
    h2 { font-size: 15px; margin: 24px 0 10px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #334155; }
    td.num { text-align: right; font-weight: 700; color: #0f172a; }
    .good { color: #15803d; font-weight: 700; } .watch { color: #b45309; font-weight: 700; } .attention { color: #b91c1c; font-weight: 700; } .none { color: #64748b; }
    .button { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 600; padding: 11px 20px; border-radius: 10px; margin: 4px 6px 4px 0; }
    .footer { background: #f1f5f9; padding: 18px 32px; }
    .footer p { margin: 0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Your weekly OJT summary</h1>
        <p>{{ $summary['school_name'] }} &middot; week of {{ $summary['week_label'] }}</p>
      </div>
      <div class="body">
        <p>Hi {{ $summary['dean_name'] }}, here is how last week went.</p>

        <h2>Interns right now ({{ $summary['groups']['total'] }})</h2>
        <table>
          <tr><td>At risk</td><td class="num">{{ $summary['groups']['at_risk'] }}</td></tr>
          <tr><td>Needs attention</td><td class="num">{{ $summary['groups']['needs_attention'] }}</td></tr>
          <tr><td>On track</td><td class="num">{{ $summary['groups']['on_track'] }}</td></tr>
          <tr><td>Completed</td><td class="num">{{ $summary['groups']['completed'] }}</td></tr>
        </table>
        @if(count($summary['at_risk_names']))
          <p style="margin-top:12px;font-size:14px;">At risk: {{ implode(', ', $summary['at_risk_names']) }}</p>
        @endif

        <h2>Last week</h2>
        <table>
          <tr><td>Approved hours rendered</td><td class="num">{{ $summary['hours_rendered'] }} h</td></tr>
          <tr><td>Interns needing a look now</td><td class="num">{{ $summary['attention_now'] }}</td></tr>
          <tr><td>Documents waiting over 3 days</td><td class="num">{{ $summary['stale_documents'] }}</td></tr>
          <tr><td>Coordinator actions{{ $summary['coordinator_name'] ? ' ('.$summary['coordinator_name'].')' : '' }}</td><td class="num">{{ $summary['coordinator_actions_last_week'] }}</td></tr>
        </table>

        <h2>Coordinator scorecard</h2>
        <table>
          @foreach($summary['verdicts'] as $v)
            <tr><td>{{ $v['title'] }}<br><span class="none">{{ $v['display'] }}</span></td><td class="num"><span class="{{ $v['tone'] === 'green' ? 'good' : ($v['tone'] === 'amber' ? 'watch' : ($v['tone'] === 'red' ? 'attention' : 'none')) }}">{{ $v['verdict'] }}</span></td></tr>
          @endforeach
        </table>

        <p style="margin-top:24px;">
          <a href="{{ $summary['links']['overview'] }}" class="button">Open overview</a>
          <a href="{{ $summary['links']['interns'] }}" class="button">See interns</a>
          <a href="{{ $summary['links']['coordinator'] }}" class="button">See coordinator</a>
        </p>
      </div>
      <div class="footer">
        <p>You get this every Monday. <a href="{{ $summary['links']['settings'] }}">Turn it off in your account settings.</a></p>
      </div>
    </div>
  </div>
</body>
</html>
