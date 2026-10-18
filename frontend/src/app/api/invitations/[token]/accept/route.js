import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';
import { backendFetch, backendUnavailable, clientIpHeader } from '@/lib/serverProxy';

export async function POST(request, { params }) {
  const { token } = await params;
  const body = await request.text();

  let response;
  try {
    response = await backendFetch(`${BACKEND_URL}/api/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...clientIpHeader(request),
      },
      body,
    }, { timeoutMs: 20000 });
  } catch (err) {
    return backendUnavailable(err);
  }

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
