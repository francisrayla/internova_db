import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';
import { backendFetch, backendUnavailable, clientIpHeader } from '@/lib/serverProxy';

export async function GET(request, { params }) {
  const { token } = await params;

  let response;
  try {
    response = await backendFetch(`${BACKEND_URL}/api/invitations/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json', ...clientIpHeader(request) },
    }, { timeoutMs: 15000 });
  } catch (err) {
    return backendUnavailable(err);
  }

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
