import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request) {
  const formData = await request.formData();

  const response = await fetch(`${BACKEND_URL}/api/auth/avatar`, {
    method: 'POST',
    headers: forwardHeaders(request),
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE(request) {
  const response = await fetch(`${BACKEND_URL}/api/auth/avatar`, {
    method: 'DELETE',
    headers: forwardHeaders(request),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
