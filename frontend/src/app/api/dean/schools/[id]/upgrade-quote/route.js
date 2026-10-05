import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function GET(request, { params }) {
  const { id } = await params;
  const { search } = new URL(request.url);

  const response = await fetch(`${BACKEND_URL}/api/dean/schools/${id}/upgrade-quote${search}`, {
    method: 'GET',
    headers: forwardHeaders(request),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
