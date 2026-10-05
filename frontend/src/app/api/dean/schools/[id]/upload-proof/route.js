import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';
import { BACKEND_URL } from '@/lib/backendUrl';

export async function POST(request, { params }) {
  const { id } = await params;
  const incomingForm = await request.formData();

  const forwardForm = new FormData();
  const file = incomingForm.get('proof');
  if (file) forwardForm.append('proof', file, file.name);

  const response = await fetch(`${BACKEND_URL}/api/dean/schools/${id}/upload-proof`, {
    method: 'POST',
    headers: forwardHeaders(request),
    body: forwardForm,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
