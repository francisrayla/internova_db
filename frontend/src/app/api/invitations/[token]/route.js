import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { token } = await params;

  const response = await fetch(`http://127.0.0.1:8000/api/invitations/${token}`, {
    headers: { Accept: 'application/json' },
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
