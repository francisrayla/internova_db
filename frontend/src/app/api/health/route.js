import { NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/backendUrl';

// Same-origin proxy so the browser never fetches the backend port directly
// (no CORS there) — used by the /maintenance page to poll whether
// maintenance mode has been turned back off.
export async function GET() {
  const response = await fetch(`${BACKEND_URL}/api/health`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
