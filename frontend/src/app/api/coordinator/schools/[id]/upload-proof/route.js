import { NextResponse } from 'next/server';
import { forwardHeaders } from '@/lib/serverProxy';

export async function POST(request, { params }) {
  const { id } = await params;
  const incomingForm = await request.formData();

  const forwardForm = new FormData();
  const file = incomingForm.get('proof');
  if (file) forwardForm.append('proof', file, file.name);

  const response = await fetch(`http://127.0.0.1:8000/api/coordinator/schools/${id}/upload-proof`, {
    method: 'POST',
    headers: forwardHeaders(request),
    body: forwardForm,
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
