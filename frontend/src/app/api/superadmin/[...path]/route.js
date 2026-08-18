import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';

async function proxy(request, params, method) {
  const pathSegments = Array.isArray(params?.path) ? params.path : [];
  const path = pathSegments.join('/') || 'dashboard';
  const upstream = `http://127.0.0.1:8000/api/superadmin/${path}`;

  const init = {
    method,
    headers: forwardHeaders(request, { 'Content-Type': 'application/json' }),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    const body = await request.text();
    if (body) init.body = body;
  }

  const response = await fetch(upstream, init);
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request, { params }) { return proxy(request, params, 'GET'); }
export async function POST(request, { params }) { return proxy(request, params, 'POST'); }
export async function PATCH(request, { params }) { return proxy(request, params, 'PATCH'); }
export async function DELETE(request, { params }) { return proxy(request, params, 'DELETE'); }
