import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';

export async function POST(request) {
  const formData = await request.formData();

  const response = await fetch('http://127.0.0.1:8000/api/auth/avatar', {
    method: 'POST',
    headers: forwardHeaders(request),
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE(request) {
  const response = await fetch('http://127.0.0.1:8000/api/auth/avatar', {
    method: 'DELETE',
    headers: forwardHeaders(request),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
