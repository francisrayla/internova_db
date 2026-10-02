import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request, { params }) {
  const { id } = await params;

  const response = await fetch(`${BACKEND_URL}/api/coordinator/schools/${id}/cancel-pending-upgrade`, {
    method: 'POST',
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
