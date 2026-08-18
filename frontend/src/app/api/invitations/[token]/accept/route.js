import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  const { token } = await params;
  const body = await request.text();

  const response = await fetch(`http://127.0.0.1:8000/api/invitations/${token}/accept`, {
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
