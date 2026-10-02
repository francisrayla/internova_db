import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function GET(request, { params }) {
  const { token } = await params;

  const response = await fetch(`${BACKEND_URL}/api/invitations/${token}`, {
    headers: { Accept: 'application/json' },
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
