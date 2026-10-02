import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function PATCH(request) {
  const body = await request.text();

  const response = await fetch(`${BACKEND_URL}/api/auth/profile`, {
    method: 'PATCH',
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
    body,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
