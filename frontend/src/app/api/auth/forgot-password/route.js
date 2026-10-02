import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request) {
  const body = await request.text();

  const response = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
