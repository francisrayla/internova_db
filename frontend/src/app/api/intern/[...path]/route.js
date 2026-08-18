import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';

async function proxy(request, params, method) {
  const pathSegments = Array.isArray(params?.path) ? params.path : [];
  const path = pathSegments.join('/');
  const { search } = new URL(request.url);
  const upstream = `http://127.0.0.1:8000/api/intern/${path}${search}`;

  const contentType = request.headers.get('content-type') || '';
  const isMultipart = contentType.includes('multipart/form-data');

  const init = {
    method,
    headers: forwardHeaders(request, isMultipart ? {} : { 'Content-Type': 'application/json' }),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = isMultipart ? await request.formData() : await request.text();
  }

  const response = await fetch(upstream, init);
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request, { params }) { return proxy(request, await params, 'GET'); }
export async function POST(request, { params }) { return proxy(request, await params, 'POST'); }
export async function PATCH(request, { params }) { return proxy(request, await params, 'PATCH'); }
export async function DELETE(request, { params }) { return proxy(request, await params, 'DELETE'); }
