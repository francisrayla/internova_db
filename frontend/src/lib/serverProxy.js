import { NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";

// Shared by every Next.js API route that proxies to the Laravel backend.
// Forwards the browser's Bearer token through to Laravel — without this,
// every proxied request would look unauthenticated no matter what the
// client sent, since Next.js route handlers run server-side and don't
// share the browser's localStorage.
export function forwardHeaders(request, extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  return headers;
}

/**
 * Route handlers that pass every request under /api/<prefix>/... straight
 * through to the same path on the Laravel backend — one implementation for
 * the per-role catch-all routes instead of a copy in each.
 */
export function createApiProxy(prefix) {
  async function proxy(request, params, method) {
    const path = (Array.isArray(params?.path) ? params.path : []).join("/");
    const { search } = new URL(request.url);
    const base = `${BACKEND_URL}/api/${prefix}`;
    const upstream = `${path ? `${base}/${path}` : base}${search}`;

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const init = {
      method,
      headers: forwardHeaders(request, isMultipart ? {} : { "Content-Type": "application/json" }),
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = isMultipart ? await request.formData() : await request.text();
    }

    const response = await fetch(upstream, init);
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  }

  const handler = (method) => async (request, { params }) => proxy(request, await params, method);
  return { GET: handler("GET"), POST: handler("POST"), PATCH: handler("PATCH"), DELETE: handler("DELETE") };
}
