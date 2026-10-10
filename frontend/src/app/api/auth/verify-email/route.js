import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';
import { clientIpHeader } from '@/lib/serverProxy';

export async function POST(request) {
  const body = await request.text();

  const response = await fetch(`${BACKEND_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...clientIpHeader(request),
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
