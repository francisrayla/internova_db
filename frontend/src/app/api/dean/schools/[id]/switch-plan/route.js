import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.text();

  const response = await fetch(`${BACKEND_URL}/api/dean/schools/${id}/switch-plan`, {
    method: 'POST',
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
    body,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
