import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

// The signed-in person's live "Needs your attention" list. Deliberately forwards NO query string:
// the backend works out role, school and user from the token alone.
export async function GET(request) {
  const response = await fetch(`${BACKEND_URL}/api/notifications/attention`, {
    method: 'GET',
    headers: forwardHeaders(request),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
