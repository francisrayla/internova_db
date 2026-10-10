import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

// Authorizes a private realtime (Reverb/Echo) channel subscription. pusher-js posts
// `socket_id` and `channel_name` (form-encoded) here with the signed-in user's Bearer token;
// we pass both on to Laravel's POST /api/broadcasting/auth, which only signs the subscription
// when routes/channels.php says this user may listen. Anything else (no token, someone else's
// channel) comes back as 401/403 and the browser simply never receives those events.
export async function POST(request) {
  const contentType = request.headers.get('content-type') || 'application/x-www-form-urlencoded';

  const response = await fetch(`${BACKEND_URL}/api/broadcasting/auth`, {
    method: 'POST',
    headers: forwardHeaders(request, { 'Content-Type': contentType }),
    body: await request.text(),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
