import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.text();

  const response = await fetch(`http://127.0.0.1:8000/api/coordinator/schools/${id}/upgrade-plan`, {
    method: 'POST',
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
    body,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
