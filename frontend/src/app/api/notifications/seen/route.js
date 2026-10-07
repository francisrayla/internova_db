import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

// The person opened the notification bell: tells the backend what was in it has been seen.
export async function POST(request) {
  const response = await fetch(`${BACKEND_URL}/api/notifications/seen`, {
    method: 'POST',
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
    body: '{}',
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
