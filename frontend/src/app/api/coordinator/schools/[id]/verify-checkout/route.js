import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request, { params }) {
  const { id } = await params;

  const response = await fetch(`${BACKEND_URL}/api/coordinator/schools/${id}/verify-checkout`, {
    method: 'POST',
    headers: forwardHeaders(request),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
