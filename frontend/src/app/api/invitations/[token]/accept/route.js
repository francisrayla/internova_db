import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request, { params }) {
  const { token } = await params;
  const body = await request.text();

  const response = await fetch(`${BACKEND_URL}/api/invitations/${token}/accept`, {
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
